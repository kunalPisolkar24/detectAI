// Package handlers implements the Connect service surfaces.
package handlers

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	usersv1 "github.com/kunalPisolkar24/detectAI/services/users/proto"
	"github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type Auth struct{}

var _ usersv1connect.AuthServiceHandler = (*Auth)(nil)

func NewAuth() *Auth { return &Auth{} }

func (Auth) Register(context.Context, *connect.Request[usersv1.RegisterRequest]) (*connect.Response[usersv1.User], error) {
	return nil, unimplemented()
}

func (Auth) Login(context.Context, *connect.Request[usersv1.LoginRequest]) (*connect.Response[usersv1.AuthTokens], error) {
	return nil, unimplemented()
}

func (Auth) Refresh(context.Context, *connect.Request[usersv1.RefreshRequest]) (*connect.Response[usersv1.AuthTokens], error) {
	return nil, unimplemented()
}

func unimplemented() error {
	return connect.NewError(connect.CodeUnimplemented, errors.New("not implemented"))
}
