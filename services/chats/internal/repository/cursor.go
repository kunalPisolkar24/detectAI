package repository

import (
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// keysetFilter narrows a history query to the messages older than the cursor's tuple.
func keysetFilter(chatID string, key store.CursorKey) bson.M {
	return bson.M{
		"chat_id": chatID,
		"$or": bson.A{
			bson.M{"created_at": bson.M{"$lt": key.T}},
			bson.M{"created_at": key.T, "_id": bson.M{"$lt": key.ID}},
		},
	}
}
