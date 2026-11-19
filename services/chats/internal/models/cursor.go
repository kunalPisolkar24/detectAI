package models

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// CursorKey is the boundary of a history page: the chat the page belongs to
// and the last message's keyset tuple.
type CursorKey struct {
	ChatID string    `json:"chat_id"`
	T      time.Time `json:"t"`
	ID     string    `json:"i"`
}

// EncodeCursor packs a keyset tuple into the opaque cursor the wire carries.
func EncodeCursor(chatID string, createdAt time.Time, id string) (string, error) {
	payload, err := json.Marshal(CursorKey{ChatID: chatID, T: createdAt, ID: id})
	if err != nil {
		return "", fmt.Errorf("models: encode cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// DecodeCursor unpacks an opaque cursor; a malformed one is the caller's bad input.
func DecodeCursor(cursor string) (CursorKey, error) {
	payload, err := base64.RawURLEncoding.Strict().DecodeString(cursor)
	if err != nil {
		return CursorKey{}, fmt.Errorf("models: decode cursor: %w", err)
	}
	var key CursorKey
	if err := json.Unmarshal(payload, &key); err != nil {
		return CursorKey{}, fmt.Errorf("models: decode cursor: %w", err)
	}
	if key.ChatID == "" || key.ID == "" || key.T.IsZero() {
		return CursorKey{}, errors.New("models: decode cursor: incomplete key")
	}
	return key, nil
}
