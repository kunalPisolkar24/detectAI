package services_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

var errRepository = errors.New("repository is down")

func TestRepositoryFaultsPropagateThroughEveryMethod(t *testing.T) {
	ctx := context.Background()
	for name, call := range map[string]func(repository *fakeRepository) error{
		"CreateChat / insert": func(r *fakeRepository) error {
			r.createChat = func(context.Context, string, string) (models.Chat, error) {
				return models.Chat{}, errRepository
			}
			_, err := newService(r, newFakeCache()).CreateChat(ctx, "owner-1", "a question")
			return err
		},
		"CreateChat / first message": func(r *fakeRepository) error {
			r.createChat = func(_ context.Context, ownerID, title string) (models.Chat, error) {
				return models.Chat{ID: "chat-1", UserID: ownerID, Title: title}, nil
			}
			r.saveUserMessage = func(context.Context, string, models.Message) (models.Message, error) {
				return models.Message{}, errRepository
			}
			_, err := newService(r, newFakeCache()).CreateChat(ctx, "owner-1", "a question")
			return err
		},
		"GetChat / meta": func(r *fakeRepository) error {
			r.chat = func(context.Context, string, string) (models.Chat, error) {
				return models.Chat{}, errRepository
			}
			_, _, _, err := newService(r, newFakeCache()).GetChat(ctx, "owner-1", "chat-1")
			return err
		},
		"GetChat / head page": func(r *fakeRepository) error {
			r.chat = func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
				return models.Chat{ID: chatID, UserID: ownerID}, nil
			}
			r.chatHistory = func(context.Context, string, string, string, int) ([]models.Message, string, error) {
				return nil, "", errRepository
			}
			_, _, _, err := newService(r, newFakeCache()).GetChat(ctx, "owner-1", "chat-1")
			return err
		},
		"RenameChat": func(r *fakeRepository) error {
			r.renameChat = func(context.Context, string, string, string) (models.ChatSummary, error) {
				return models.ChatSummary{}, errRepository
			}
			_, err := newService(r, newFakeCache()).RenameChat(ctx, "owner-1", "chat-1", "a title")
			return err
		},
		"DeleteChat": func(r *fakeRepository) error {
			r.deleteChat = func(context.Context, string, string) error { return errRepository }
			return newService(r, newFakeCache()).DeleteChat(ctx, "owner-1", "chat-1")
		},
		"SaveUserMessage": func(r *fakeRepository) error {
			r.saveUserMessage = func(context.Context, string, models.Message) (models.Message, error) {
				return models.Message{}, errRepository
			}
			_, err := newService(r, newFakeCache()).SaveUserMessage(ctx, "owner-1", "chat-1", "m1", "hello", time.Now())
			return err
		},
		"SaveAnalysisMessage": func(r *fakeRepository) error {
			r.saveAnalysisMessage = func(context.Context, string, models.Message) (models.Message, error) {
				return models.Message{}, errRepository
			}
			_, err := newService(r, newFakeCache()).SaveAnalysisMessage(ctx, "owner-1", "chat-1", "m1", time.Now(), &models.Analysis{
				State: models.StateRunning, Model: models.ModelSpark, SourceMessageID: "source-1",
			})
			return err
		},
		"GetChatHistory / cursor page": func(r *fakeRepository) error {
			r.chatHistory = func(context.Context, string, string, string, int) ([]models.Message, string, error) {
				return nil, "", errRepository
			}
			_, _, err := newService(r, newFakeCache()).GetChatHistory(ctx, "owner-1", "chat-1", "cursor", 5)
			return err
		},
		"GetChatHistory / meta": func(r *fakeRepository) error {
			r.chat = func(context.Context, string, string) (models.Chat, error) {
				return models.Chat{}, errRepository
			}
			_, _, err := newService(r, newFakeCache()).GetChatHistory(ctx, "owner-1", "chat-1", "", 5)
			return err
		},
		"GetChatHistory / head page": func(r *fakeRepository) error {
			r.chat = func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
				return models.Chat{ID: chatID, UserID: ownerID}, nil
			}
			r.chatHistory = func(context.Context, string, string, string, int) ([]models.Message, string, error) {
				return nil, "", errRepository
			}
			_, _, err := newService(r, newFakeCache()).GetChatHistory(ctx, "owner-1", "chat-1", "", 5)
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := call(&fakeRepository{}); !errors.Is(err, errRepository) {
				t.Fatalf("err = %v, want the repository fault", err)
			}
		})
	}
}

func TestEmptyChatIDsAreRejectedBeforeTheRepository(t *testing.T) {
	repo := &fakeRepository{}
	service := newService(repo, newFakeCache())
	ctx := context.Background()

	if _, _, _, err := service.GetChat(ctx, "owner-1", ""); err == nil {
		t.Error("GetChat with an empty id must fail")
	}
	if _, err := service.RenameChat(ctx, "owner-1", "", "a title"); err == nil {
		t.Error("RenameChat with an empty id must fail")
	}
	if err := service.DeleteChat(ctx, "owner-1", ""); err == nil {
		t.Error("DeleteChat with an empty id must fail")
	}
	if _, _, err := service.GetChatHistory(ctx, "owner-1", "", "", 5); err == nil {
		t.Error("GetChatHistory with an empty id must fail")
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestListCacheFaultsAndWriteFaultsAreAbsorbed(t *testing.T) {
	ctx := context.Background()

	t.Run("a list read fault falls back", func(t *testing.T) {
		entries := newFakeCache()
		entries.readErr = errors.New("redis is down")
		service := newService(&fakeRepository{}, entries)
		if _, err := service.ListChats(ctx, "owner-1", 5); err != nil {
			t.Fatalf("ListChats: %v", err)
		}
	})

	t.Run("a list repository fault propagates", func(t *testing.T) {
		repo := &fakeRepository{}
		repo.chats = func(context.Context, string, int) ([]models.ChatSummary, error) {
			return nil, errRepository
		}
		service := newService(repo, newFakeCache())
		if _, err := service.ListChats(ctx, "owner-1", 5); !errors.Is(err, errRepository) {
			t.Fatalf("err = %v, want the repository fault", err)
		}
	})

	t.Run("a list write fault is absorbed", func(t *testing.T) {
		entries := newFakeCache()
		entries.writeErr = errors.New("redis is down")
		service := newService(&fakeRepository{}, entries)
		if _, err := service.ListChats(ctx, "owner-1", 5); err != nil {
			t.Fatalf("ListChats: %v", err)
		}
	})

	t.Run("a meta invalidation fault is absorbed", func(t *testing.T) {
		entries := newFakeCache()
		entries.writeErr = errors.New("redis is down")
		service := newService(&fakeRepository{}, entries)
		if _, err := service.RenameChat(ctx, "owner-1", "chat-1", "a title"); err != nil {
			t.Fatalf("RenameChat: %v", err)
		}
	})
}

func TestALongInitialMessageBecomesACappedTitle(t *testing.T) {
	var savedTitle string
	repo := &fakeRepository{
		createChat: func(_ context.Context, ownerID, title string) (models.Chat, error) {
			savedTitle = title
			return models.Chat{ID: "chat-1", UserID: ownerID, Title: title}, nil
		},
	}

	message := strings.Repeat("x", models.MaxTitleLen+20)
	if _, err := newService(repo, newFakeCache()).CreateChat(context.Background(), "owner-1", message); err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if len([]rune(savedTitle)) != models.MaxTitleLen {
		t.Errorf("title length = %d, want the %d-run cap", len([]rune(savedTitle)), models.MaxTitleLen)
	}
}

func TestAnAnalysisMessageWithoutAChatIDIsRejected(t *testing.T) {
	repo := &fakeRepository{}
	service := newService(repo, newFakeCache())

	_, err := service.SaveAnalysisMessage(context.Background(), "owner-1", "", "m1", time.Now(), &models.Analysis{
		State: models.StateRunning, Model: models.ModelSpark, SourceMessageID: "source-1",
	})
	if err == nil {
		t.Fatal("SaveAnalysisMessage with an empty chat id must fail validation")
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestTrimPageRejectsAnUnencodableTimestamp(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID}, nil
		},
	}
	entries := newFakeCache()
	entries.heads["chat-1"] = models.Page{Messages: []models.Message{
		{ID: "m1", ChatID: "chat-1", CreatedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "m2", ChatID: "chat-1", CreatedAt: time.Now()},
	}}
	service := newService(repo, entries)

	_, _, err := service.GetChatHistory(context.Background(), "owner-1", "chat-1", "", 1)
	if err == nil {
		t.Fatal("GetChatHistory = nil error, want the unencodable cursor failure")
	}
}
