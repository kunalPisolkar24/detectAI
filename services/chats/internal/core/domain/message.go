package domain

import "time"

type AnalysisResult struct {
	HumanScore float64 `bson:"human_score" json:"human_score"`
	AIScore    float64 `bson:"ai_score" json:"ai_score"`
	ModelName  string  `bson:"model_name" json:"model_name"`
	Verdict    string  `bson:"verdict" json:"verdict"`
}

type Message struct {
	ID        string            `bson:"_id,omitempty" json:"id"`
	ChatID    string            `bson:"chat_id" json:"chat_id"`
	UserID    string            `bson:"user_id" json:"user_id"`
	Role      string            `bson:"role" json:"role"`
	Content   string            `bson:"content" json:"content"`
	Metadata  map[string]string `bson:"metadata" json:"metadata"`
	Analysis  *AnalysisResult   `bson:"analysis,omitempty" json:"analysis,omitempty"`
	CreatedAt time.Time         `bson:"created_at" json:"created_at"`
}

type MessageBucket struct {
	ID          string    `bson:"_id"`
	ChatID      string    `bson:"chat_id"`
	BucketIndex int       `bson:"bucket_index"`
	Count       int       `bson:"count"`
	Messages    []Message `bson:"messages"`
	StartDate   time.Time `bson:"start_date"`
	EndDate     time.Time `bson:"end_date"`
}