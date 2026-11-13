package repository

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// cursorKey is the page boundary: the chat the page belongs to and the last
// message's keyset tuple.
type cursorKey struct {
	ChatID string    `json:"chat_id"`
	T      time.Time `json:"t"`
	ID     string    `json:"i"`
}

// encodeCursor packs the keyset tuple into the opaque cursor the wire carries.
func encodeCursor(chatID string, createdAt time.Time, id string) (string, error) {
	payload, err := json.Marshal(cursorKey{ChatID: chatID, T: createdAt, ID: id})
	if err != nil {
		return "", fmt.Errorf("repository: encode cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// decodeCursor unpacks an opaque cursor; a malformed one is the caller's bad input.
func decodeCursor(cursor string) (cursorKey, error) {
	payload, err := base64.RawURLEncoding.Strict().DecodeString(cursor)
	if err != nil {
		return cursorKey{}, fmt.Errorf("repository: decode cursor: %w", err)
	}
	var key cursorKey
	if err := json.Unmarshal(payload, &key); err != nil {
		return cursorKey{}, fmt.Errorf("repository: decode cursor: %w", err)
	}
	if key.ChatID == "" || key.ID == "" || key.T.IsZero() {
		return cursorKey{}, errors.New("repository: decode cursor: incomplete key")
	}
	return key, nil
}

// keysetFilter narrows a history query to the messages older than the cursor's tuple.
func keysetFilter(chatID string, key cursorKey) bson.M {
	return bson.M{
		"chat_id": chatID,
		"$or": bson.A{
			bson.M{"created_at": bson.M{"$lt": key.T}},
			bson.M{"created_at": key.T, "_id": bson.M{"$lt": key.ID}},
		},
	}
}
