package handlers

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
	usersv1 "github.com/kunalPisolkar24/detectAI/services/users/proto"
	"github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type User struct {
	users    *services.UserService
	identity identity
}

var _ usersv1connect.UserServiceHandler = (*User)(nil)

func NewUser(users *services.UserService, verifier token.AccessVerifier, lookup UserLookup) *User {
	return &User{users: users, identity: newIdentity(verifier, lookup)}
}

func (u *User) GetMe(ctx context.Context, req *connect.Request[usersv1.GetMeRequest]) (*connect.Response[usersv1.User], error) {
	if u.users == nil {
		return nil, unimplemented()
	}
	userID, err := u.identity.userID(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	user, err := u.users.GetMe(ctx, userID)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(userProto(user)), nil
}

func (u *User) Logout(ctx context.Context, req *connect.Request[usersv1.LogoutRequest]) (*connect.Response[emptypb.Empty], error) {
	if u.users == nil {
		return nil, unimplemented()
	}
	userID, err := u.identity.userID(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	raw, err := refreshToken(req.Header())
	if err != nil {
		return nil, err
	}
	if err := u.users.Logout(ctx, userID, raw); err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (u *User) LogoutAll(ctx context.Context, req *connect.Request[usersv1.LogoutAllRequest]) (*connect.Response[emptypb.Empty], error) {
	if u.users == nil {
		return nil, unimplemented()
	}
	userID, err := u.identity.userID(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := u.users.LogoutAll(ctx, userID); err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}
