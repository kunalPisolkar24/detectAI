package repository

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// writeAttempts bounds the read-insert race on the analysis upsert.
const writeAttempts = 3

// SaveUserMessage is insert-only — a duplicate id replays the stored message.
func (r *Repository) SaveUserMessage(ctx context.Context, ownerID string, msg store.Message) (store.Message, error) {
	if err := r.ownChat(ctx, ownerID, msg.ChatID); err != nil {
		return store.Message{}, err
	}
	if msg.ID == "" {
		msg.ID = uuid.NewString()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now()
	}
	msg.CreatedAt = stamp(msg.CreatedAt)

	if _, err := r.messages.InsertOne(ctx, msg); err != nil {
		if !driver.IsDuplicateKeyError(err) {
			return store.Message{}, wrap("save user message", err)
		}
		stored, found, err := r.chatMessage(ctx, msg.ID, msg.ChatID)
		if err != nil {
			return store.Message{}, err
		}
		if !found {
			return store.Message{}, store.ErrNotFound
		}
		return stored, nil
	}
	if err := r.bumpChat(ctx, msg.ChatID); err != nil {
		return store.Message{}, err
	}
	return msg, nil
}

// SaveAnalysisMessage upserts the analysis state machine keyed on id.
func (r *Repository) SaveAnalysisMessage(ctx context.Context, ownerID string, msg store.Message) (store.Message, error) {
	if err := r.ownChat(ctx, ownerID, msg.ChatID); err != nil {
		return store.Message{}, err
	}
	if msg.ID == "" {
		msg.ID = uuid.NewString()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now()
	}
	msg.CreatedAt = stamp(msg.CreatedAt)

	for attempt := 0; attempt < writeAttempts; attempt++ {
		var stored store.Message
		err := r.messages.FindOne(ctx, bson.M{"_id": msg.ID}).Decode(&stored)
		if errors.Is(err, driver.ErrNoDocuments) {
			if _, err := r.messages.InsertOne(ctx, msg); err != nil {
				if driver.IsDuplicateKeyError(err) {
					continue
				}
				return store.Message{}, wrap("save analysis message", err)
			}
			if err := r.bumpChat(ctx, msg.ChatID); err != nil {
				return store.Message{}, err
			}
			return msg, nil
		}
		if err != nil {
			return store.Message{}, wrap("save analysis message", err)
		}

		if stored.ChatID != msg.ChatID {
			return store.Message{}, store.ErrNotFound
		}
		if terminal(stored.Analysis) {
			if sameAnalysis(stored.Analysis, msg.Analysis) {
				return stored, nil
			}
			return store.Message{}, store.ErrConflict
		}

		updated, err := r.setAnalysis(ctx, stored.ID, msg.Analysis)
		if err != nil {
			return store.Message{}, err
		}
		if err := r.bumpChat(ctx, msg.ChatID); err != nil {
			return store.Message{}, err
		}
		return updated, nil
	}
	return store.Message{}, errors.New("repository: save analysis message: concurrent write did not settle")
}

// ChatHistory pages newest-first on the (created_at, _id) keyset.
func (r *Repository) ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]store.Message, string, error) {
	if err := r.ownChat(ctx, ownerID, chatID); err != nil {
		return nil, "", err
	}
	limit = store.ClampHistoryLimit(limit)

	filter := bson.M{"chat_id": chatID}
	if cursor != "" {
		key, err := store.DecodeCursor(cursor)
		if err != nil || key.ChatID != chatID {
			return nil, "", store.ErrInvalidCursor
		}
		filter = keysetFilter(chatID, key)
	}

	find, err := r.messages.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}).
		SetLimit(int64(limit)+1))
	if err != nil {
		return nil, "", wrap("chat history", err)
	}
	defer find.Close(ctx)

	var messages []store.Message
	if err := find.All(ctx, &messages); err != nil {
		return nil, "", wrap("chat history", err)
	}
	if len(messages) <= limit {
		return messages, "", nil
	}

	page := messages[:limit]
	last := page[len(page)-1]
	next, err := store.EncodeCursor(chatID, last.CreatedAt, last.ID)
	if err != nil {
		return nil, "", err
	}
	return page, next, nil
}

// chatMessage reads the message bound to one chat; a miss means the id belongs elsewhere.
func (r *Repository) chatMessage(ctx context.Context, id, chatID string) (store.Message, bool, error) {
	var msg store.Message
	err := r.messages.FindOne(ctx, bson.M{"_id": id, "chat_id": chatID}).Decode(&msg)
	if errors.Is(err, driver.ErrNoDocuments) {
		return store.Message{}, false, nil
	}
	if err != nil {
		return store.Message{}, false, wrap("message", err)
	}
	return msg, true, nil
}

// setAnalysis writes the analysis payload, leaving created_at as it was inserted.
func (r *Repository) setAnalysis(ctx context.Context, id string, analysis *store.Analysis) (store.Message, error) {
	var updated store.Message
	err := r.messages.FindOneAndUpdate(ctx,
		bson.M{"_id": id},
		bson.M{"$set": bson.M{"analysis": analysis}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if errors.Is(err, driver.ErrNoDocuments) {
		return store.Message{}, store.ErrNotFound
	}
	if err != nil {
		return store.Message{}, wrap("set analysis", err)
	}
	return updated, nil
}

// terminal reports whether the analysis state machine has settled.
func terminal(analysis *store.Analysis) bool {
	if analysis == nil {
		return false
	}
	switch analysis.State {
	case store.StateCompleted, store.StateFailed, store.StateCancelled:
		return true
	}
	return false
}

// sameAnalysis reports whether an incoming analysis is an identical replay of the stored one.
func sameAnalysis(stored, incoming *store.Analysis) bool {
	if stored == nil || incoming == nil {
		return stored == incoming
	}
	if stored.State != incoming.State ||
		stored.Model != incoming.Model ||
		stored.SourceMessageID != incoming.SourceMessageID ||
		stored.Error != incoming.Error {
		return false
	}
	return sameResult(stored.Result, incoming.Result)
}

// sameResult reports whether two detection verdicts match.
func sameResult(stored, incoming *store.AnalysisResult) bool {
	if stored == nil || incoming == nil {
		return stored == incoming
	}
	if stored.Label != incoming.Label ||
		stored.Confidence != incoming.Confidence ||
		stored.Scores != incoming.Scores {
		return false
	}
	if !slices.Equal(stored.Highlights, incoming.Highlights) {
		return false
	}
	return reflect.DeepEqual(normalize(stored.Raw), normalize(incoming.Raw))
}

// normalize flattens the document types bson decodes into, so a stored payload
// and the one that produced it compare equal.
func normalize(value any) any {
	switch typed := value.(type) {
	case bson.D:
		out := make(map[string]any, len(typed))
		for _, element := range typed {
			out[element.Key] = normalize(element.Value)
		}
		return out
	case bson.A:
		out := make([]any, len(typed))
		for i, element := range typed {
			out[i] = normalize(element)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, element := range typed {
			out[key] = normalize(element)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, element := range typed {
			out[i] = normalize(element)
		}
		return out
	default:
		return value
	}
}
