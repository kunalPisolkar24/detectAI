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

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// writeAttempts bounds the read-insert race on the analysis upsert.
const writeAttempts = 3

// SaveUserMessage is insert-only: a duplicate id replays the stored message.
func (r *Mongo) SaveUserMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	start := time.Now()
	saved, err := r.saveUserMessage(ctx, ownerID, msg)
	r.record(observability.DatastoreOperationSaveUserMessage, err, start)
	return saved, err
}

func (r *Mongo) saveUserMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	if err := r.ownChat(ctx, ownerID, msg.ChatID); err != nil {
		return models.Message{}, err
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
			return models.Message{}, wrap("save user message", err)
		}
		stored, found, err := r.chatMessage(ctx, msg.ID, msg.ChatID)
		if err != nil {
			return models.Message{}, err
		}
		if !found {
			return models.Message{}, models.ErrNotFound
		}
		return stored, nil
	}
	if err := r.bumpChat(ctx, msg.ChatID); err != nil {
		return models.Message{}, err
	}
	return msg, nil
}

func (r *Mongo) SaveAnalysisMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	start := time.Now()
	saved, err := r.saveAnalysisMessage(ctx, ownerID, msg)
	r.record(observability.DatastoreOperationSaveAnalysisMessage, err, start)
	return saved, err
}

func (r *Mongo) saveAnalysisMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	if err := r.ownChat(ctx, ownerID, msg.ChatID); err != nil {
		return models.Message{}, err
	}
	if msg.ID == "" {
		msg.ID = uuid.NewString()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now()
	}
	msg.CreatedAt = stamp(msg.CreatedAt)

	for attempt := 0; attempt < writeAttempts; attempt++ {
		var stored models.Message
		err := r.messages.FindOne(ctx, bson.M{"_id": msg.ID}).Decode(&stored)
		if errors.Is(err, driver.ErrNoDocuments) {
			if _, err := r.messages.InsertOne(ctx, msg); err != nil {
				if driver.IsDuplicateKeyError(err) {
					continue
				}
				return models.Message{}, wrap("save analysis message", err)
			}
			if err := r.bumpChat(ctx, msg.ChatID); err != nil {
				return models.Message{}, err
			}
			return msg, nil
		}
		if err != nil {
			return models.Message{}, wrap("save analysis message", err)
		}

		if stored.ChatID != msg.ChatID {
			return models.Message{}, models.ErrNotFound
		}
		if terminal(stored.Analysis) {
			if sameAnalysis(stored.Analysis, msg.Analysis) {
				return stored, nil
			}
			return models.Message{}, models.ErrConflict
		}

		updated, err := r.setAnalysis(ctx, stored.ID, msg.Analysis)
		if err != nil {
			return models.Message{}, err
		}
		if err := r.bumpChat(ctx, msg.ChatID); err != nil {
			return models.Message{}, err
		}
		return updated, nil
	}
	return models.Message{}, errors.New("repository: save analysis message: concurrent write did not settle")
}

// ChatHistory pages a chat's messages newest-first.
func (r *Mongo) ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error) {
	start := time.Now()
	messages, next, err := r.chatHistory(ctx, ownerID, chatID, cursor, limit)
	r.record(observability.DatastoreOperationChatHistory, err, start)
	return messages, next, err
}

func (r *Mongo) chatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error) {
	if err := r.ownChat(ctx, ownerID, chatID); err != nil {
		return nil, "", err
	}
	limit = models.ClampHistoryLimit(limit)

	filter := bson.M{"chat_id": chatID}
	if cursor != "" {
		key, err := models.DecodeCursor(cursor)
		if err != nil || key.ChatID != chatID {
			return nil, "", models.ErrInvalidCursor
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

	var messages []models.Message
	if err := find.All(ctx, &messages); err != nil {
		return nil, "", wrap("chat history", err)
	}
	if len(messages) <= limit {
		return messages, "", nil
	}

	page := messages[:limit]
	last := page[len(page)-1]
	next, err := models.EncodeCursor(chatID, last.CreatedAt, last.ID)
	if err != nil {
		return nil, "", err
	}
	return page, next, nil
}

// A miss means the id belongs elsewhere.
func (r *Mongo) chatMessage(ctx context.Context, id, chatID string) (models.Message, bool, error) {
	var msg models.Message
	err := r.messages.FindOne(ctx, bson.M{"_id": id, "chat_id": chatID}).Decode(&msg)
	if errors.Is(err, driver.ErrNoDocuments) {
		return models.Message{}, false, nil
	}
	if err != nil {
		return models.Message{}, false, wrap("message", err)
	}
	return msg, true, nil
}

// setAnalysis leaves created_at as it was inserted.
func (r *Mongo) setAnalysis(ctx context.Context, id string, analysis *models.Analysis) (models.Message, error) {
	var updated models.Message
	err := r.messages.FindOneAndUpdate(ctx,
		bson.M{"_id": id},
		bson.M{"$set": bson.M{"analysis": analysis}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if errors.Is(err, driver.ErrNoDocuments) {
		return models.Message{}, models.ErrNotFound
	}
	if err != nil {
		return models.Message{}, wrap("set analysis", err)
	}
	return updated, nil
}

func terminal(analysis *models.Analysis) bool {
	if analysis == nil {
		return false
	}
	switch analysis.State {
	case models.StateCompleted, models.StateFailed, models.StateCancelled:
		return true
	}
	return false
}

func sameAnalysis(stored, incoming *models.Analysis) bool {
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

func sameResult(stored, incoming *models.AnalysisResult) bool {
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
