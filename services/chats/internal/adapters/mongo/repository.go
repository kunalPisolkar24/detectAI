package mongo

import (
	"context"
	"errors"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("chats/mongo")

func startSpan(ctx context.Context, operation string) (context.Context, oteltrace.Span, time.Time) {
	ctx, span := tracer.Start(ctx, "mongo."+operation,
		oteltrace.WithSpanKind(oteltrace.SpanKindClient),
		oteltrace.WithAttributes(
			attribute.String("db.system", "mongodb"),
			attribute.String("db.operation", operation),
		),
	)
	return ctx, span, time.Now().UTC()
}

func finishSpan(span oteltrace.Span, operation string, start time.Time, err error) {
	metrics.MongoOpDuration.WithLabelValues(operation).Observe(time.Since(start).Seconds())
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

type MongoRepository struct {
	db          *mongo.Database
	chatColl    *mongo.Collection
	messageColl *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		db:          db,
		chatColl:    db.Collection("chats"),
		messageColl: db.Collection("messages"),
	}
}

func (r *MongoRepository) CreateChat(ctx context.Context, chat *domain.ChatSession) error {
	ctx, span, start := startSpan(ctx, "create_chat")
	_, err := r.chatColl.InsertOne(ctx, chat)
	finishSpan(span, "create_chat", start, err)
	return err
}

func (r *MongoRepository) GetChat(ctx context.Context, chatID string) (*domain.ChatSession, error) {
	ctx, span, start := startSpan(ctx, "get_chat")
	var chat domain.ChatSession
	err := r.chatColl.FindOne(ctx, bson.M{"_id": chatID}).Decode(&chat)
	finishSpan(span, "get_chat", start, err)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &chat, nil
}

func (r *MongoRepository) GetUserChats(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error) {
	ctx, span, start := startSpan(ctx, "get_user_chats")
	if limit <= 0 {
		limit = domain.DefaultUserChatsLimit
	}
	if limit > domain.MaxUserChatsLimit {
		limit = domain.MaxUserChatsLimit
	}
	opts := options.Find().
		SetSort(bson.D{{Key: "updated_at", Value: -1}}).
		SetLimit(int64(limit))

	cursor, err := r.chatColl.Find(ctx, bson.M{"user_id": userID}, opts)
	if err != nil {
		finishSpan(span, "get_user_chats", start, err)
		return nil, err
	}
	defer cursor.Close(ctx)

	var chats []*domain.ChatSession
	if err := cursor.All(ctx, &chats); err != nil {
		finishSpan(span, "get_user_chats", start, err)
		return nil, err
	}
	finishSpan(span, "get_user_chats", start, nil)
	if chats == nil {
		return []*domain.ChatSession{}, nil
	}
	return chats, nil
}

func (r *MongoRepository) UpdateChatTitle(ctx context.Context, chatID, title string) error {
	ctx, span, start := startSpan(ctx, "update_chat_title")
	filter := bson.M{"_id": chatID}
	update := bson.M{"$set": bson.M{"title": title, "updated_at": time.Now().UTC()}}

	res, err := r.chatColl.UpdateOne(ctx, filter, update)
	if err != nil {
		finishSpan(span, "update_chat_title", start, err)
		return err
	}
	if res.MatchedCount == 0 {
		finishSpan(span, "update_chat_title", start, nil)
		return domain.ErrNotFound
	}
	finishSpan(span, "update_chat_title", start, nil)
	return nil
}

func (r *MongoRepository) DeleteChat(ctx context.Context, chatID string) error {
	ctx, span, start := startSpan(ctx, "delete_chat")
	res, err := r.chatColl.DeleteOne(ctx, bson.M{"_id": chatID})
	if err != nil {
		finishSpan(span, "delete_chat", start, err)
		return err
	}
	if res.DeletedCount == 0 {
		finishSpan(span, "delete_chat", start, nil)
		return domain.ErrNotFound
	}

	_, err = r.messageColl.DeleteMany(ctx, bson.M{"chat_id": chatID})
	finishSpan(span, "delete_chat", start, err)
	return err
}

func (r *MongoRepository) BulkUpsertMessages(ctx context.Context, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	ctx, span, start := startSpan(ctx, "bulk_upsert")
	span.SetAttributes(attribute.Int("db.batch_size", len(messages)))
	err := r.bulkUpsert(ctx, messages)
	finishSpan(span, "bulk_upsert", start, err)
	return err
}

func (r *MongoRepository) bulkUpsert(ctx context.Context, messages []*domain.Message) error {
	now := time.Now().UTC()

	for _, msg := range messages {
		if msg == nil || msg.ID == "" || msg.ChatID == "" {
			continue
		}
		if msg.CreatedAt.IsZero() {
			msg.CreatedAt = now
		}

		updateExistingResult, err := r.messageColl.UpdateOne(
			ctx,
			bson.M{
				"chat_id":      msg.ChatID,
				"messages._id": msg.ID,
			},
			bson.M{
				"$set": bson.M{
					"messages.$": msg,
				},
			},
		)
		if err != nil {
			return err
		}

		if updateExistingResult.MatchedCount > 0 {
			continue
		}

		bucketTime := msg.CreatedAt
		if bucketTime.After(now) {
			bucketTime = now
		}
		filter := bson.M{
			"chat_id": msg.ChatID,
			"count":   bson.M{"$lt": domain.BucketCapacity},
			"end_date": bson.M{
				"$gt": now.Add(-domain.BucketWindow),
			},
		}

		update := bson.M{
			"$push": bson.M{"messages": msg},
			"$inc":  bson.M{"count": 1},
			"$max":  bson.M{"end_date": msg.CreatedAt},
			"$min":  bson.M{"start_date": msg.CreatedAt},
			"$setOnInsert": bson.M{
				"chat_id":      msg.ChatID,
				"bucket_index": bucketTime.UnixNano(),
			},
		}

		if _, err := r.messageColl.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true)); err != nil {
			return err
		}
	}

	return nil
}

func (r *MongoRepository) GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	ctx, span, start := startSpan(ctx, "get_history")
	msgs, err := r.getHistory(ctx, chatID, offset, limit)
	finishSpan(span, "get_history", start, err)
	return msgs, err
}

func (r *MongoRepository) getHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	if limit <= 0 {
		limit = domain.DefaultPageSize
	}
	if limit > domain.MaxPageSize {
		limit = domain.MaxPageSize
	}
	if offset < 0 {
		offset = 0
	}
	needed := offset + limit
	bucketLimit := (needed / domain.BucketCapacity) + 2
	if bucketLimit > domain.MaxBucketsFetch {
		bucketLimit = domain.MaxBucketsFetch
	}

	findOpts := options.Find().
		SetSort(bson.D{{Key: "bucket_index", Value: -1}}).
		SetLimit(int64(bucketLimit))

	cursor, err := r.messageColl.Find(ctx, bson.M{"chat_id": chatID}, findOpts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var buckets []domain.MessageBucket
	if err := cursor.All(ctx, &buckets); err != nil {
		return nil, err
	}

	allMessages := make([]*domain.Message, 0, len(buckets)*domain.BucketCapacity)
	for _, bucket := range buckets {
		for i := range bucket.Messages {
			msgCopy := bucket.Messages[i]
			allMessages = append(allMessages, &msgCopy)
		}
	}

	domain.SortMessagesDesc(allMessages)

	if offset >= len(allMessages) {
		return []*domain.Message{}, nil
	}

	end := offset + limit
	if end > len(allMessages) {
		end = len(allMessages)
	}

	return allMessages[offset:end], nil
}
