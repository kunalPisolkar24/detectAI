package repository_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

func completedAnalysis() *models.Analysis {
	return &models.Analysis{
		State:           models.StateCompleted,
		Model:           models.ModelSpark,
		SourceMessageID: "source-1",
		Result: &models.AnalysisResult{
			Label:      models.LabelAI,
			Confidence: 0.9,
			Scores:     models.Scores{AI: 0.9, Human: 0.1},
			Highlights: []models.Highlight{{CharStart: 0, CharEnd: 4, AIConfidence: 0.8, Label: models.LabelAI}},
			Raw: map[string]any{
				"doc": map[string]any{"verdict": "ai"},
				"arr": []any{"first", map[string]any{"score": 0.5}},
				"num": 0.9,
				"nil": nil,
			},
		},
	}
}

func TestAnalysisReplayNormalisesTheBsonShapes(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	id := uuid.NewString()

	stored, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID: id, ChatID: chat.ID, Role: models.RoleAssistant, Analysis: completedAnalysis(),
	})
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	replay, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID: id, ChatID: chat.ID, Role: models.RoleAssistant, Analysis: completedAnalysis(),
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !replay.CreatedAt.Equal(stored.CreatedAt) {
		t.Errorf("replay created at = %v, want the stored %v", replay.CreatedAt, stored.CreatedAt)
	}
}

func TestAnalysisReplayRejectsEachChangedField(t *testing.T) {
	for name, change := range map[string]func(*models.Analysis){
		"state": func(a *models.Analysis) { a.State = models.StateFailed },
		"model": func(a *models.Analysis) { a.Model = models.ModelFlare },
		"source message": func(a *models.Analysis) {
			a.SourceMessageID = "another-source"
		},
		"error": func(a *models.Analysis) { a.Error = "inference timeout" },
		"label": func(a *models.Analysis) { a.Result.Label = models.LabelHuman },
		"confidence": func(a *models.Analysis) {
			a.Result.Confidence = 0.1
		},
		"scores": func(a *models.Analysis) { a.Result.Scores = models.Scores{AI: 0.1, Human: 0.9} },
		"highlights": func(a *models.Analysis) {
			a.Result.Highlights = []models.Highlight{{CharStart: 9, CharEnd: 12, Label: models.LabelHuman}}
		},
		"raw":            func(a *models.Analysis) { a.Result.Raw["doc"] = map[string]any{"verdict": "human"} },
		"missing result": func(a *models.Analysis) { a.Result = nil },
	} {
		t.Run(name, func(t *testing.T) {
			repo := newRepository(t)
			ownerID := owner()
			chat := createChat(t, repo, ownerID, "thread")
			id := uuid.NewString()

			if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
				ID: id, ChatID: chat.ID, Role: models.RoleAssistant, Analysis: completedAnalysis(),
			}); err != nil {
				t.Fatalf("SaveAnalysisMessage: %v", err)
			}

			incoming := completedAnalysis()
			change(incoming)
			_, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
				ID: id, ChatID: chat.ID, Role: models.RoleAssistant, Analysis: incoming,
			})
			assertErrorIs(t, err, models.ErrConflict)
		})
	}
}
