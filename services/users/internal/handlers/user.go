package handlers

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"

	usersv1 "github.com/kunalPisolkar24/detectAI/services/users/proto"
	"github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type User struct{}

var _ usersv1connect.UserServiceHandler = (*User)(nil)

func NewUser() *User { return &User{} }

func (User) GetMe(context.Context, *connect.Request[usersv1.GetMeRequest]) (*connect.Response[usersv1.User], error) {
	return nil, unimplemented()
}

func (User) Logout(context.Context, *connect.Request[usersv1.LogoutRequest]) (*connect.Response[emptypb.Empty], error) {
	return nil, unimplemented()
}

func (User) LogoutAll(context.Context, *connect.Request[usersv1.LogoutAllRequest]) (*connect.Response[emptypb.Empty], error) {
	return nil, unimplemented()
}
