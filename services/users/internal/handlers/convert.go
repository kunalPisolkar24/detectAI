package handlers

import (
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/services"
	usersv1 "github.com/kunalPisolkar24/detectAI/services/users/proto"
)

func userProto(user models.User) *usersv1.User {
	return &usersv1.User{
		Id:            user.ID.String(),
		Email:         user.Email,
		Name:          user.Name.String,
		FirstName:     user.FirstName.String,
		LastName:      user.LastName.String,
		Image:         user.Image.String,
		EmailVerified: user.EmailVerifiedAt.Valid,
		CreatedAt:     timestamppb.New(user.CreatedAt),
	}
}

func tokensProto(tokens services.AuthTokens) *usersv1.AuthTokens {
	return &usersv1.AuthTokens{
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresIn:    int64(tokens.ExpiresIn.Seconds()),
		User:         userProto(tokens.User),
	}
}
