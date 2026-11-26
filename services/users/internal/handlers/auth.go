// Package handlers implements the Connect service surfaces.
package handlers

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/services"
	usersv1 "github.com/kunalPisolkar24/detectAI/services/users/proto"
	"github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type Auth struct {
	auth *services.AuthService
}

var _ usersv1connect.AuthServiceHandler = (*Auth)(nil)

func NewAuth(auth *services.AuthService) *Auth {
	return &Auth{auth: auth}
}

func (a *Auth) Register(ctx context.Context, req *connect.Request[usersv1.RegisterRequest]) (*connect.Response[usersv1.User], error) {
	if a.auth == nil {
		return nil, unimplemented()
	}
	msg := req.Msg
	user, err := a.auth.Register(ctx, msg.GetEmail(), msg.GetPassword(), msg.GetFirstName(), msg.GetLastName())
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(userProto(user)), nil
}

func (a *Auth) Login(ctx context.Context, req *connect.Request[usersv1.LoginRequest]) (*connect.Response[usersv1.AuthTokens], error) {
	if a.auth == nil {
		return nil, unimplemented()
	}
	tokens, err := a.auth.Login(ctx, req.Msg.GetEmail(), req.Msg.GetPassword())
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(tokensProto(tokens)), nil
}

func (a *Auth) Refresh(ctx context.Context, req *connect.Request[usersv1.RefreshRequest]) (*connect.Response[usersv1.AuthTokens], error) {
	if a.auth == nil {
		return nil, unimplemented()
	}
	raw, err := refreshToken(req.Header())
	if err != nil {
		return nil, err
	}
	tokens, err := a.auth.Refresh(ctx, raw)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(tokensProto(tokens)), nil
}

func unimplemented() error {
	return connect.NewError(connect.CodeUnimplemented, errors.New("not implemented"))
}
