package http

import (
	"github.com/gin-gonic/gin"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/platform/observability"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
)

func SetupRouter(monitor *observability.Monitor, handler *Handler) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(otelgin.Middleware("payment-gateway"))
	if monitor != nil {
		r.Use(monitor.Middleware())
		r.GET("/metrics", gin.WrapH(monitor.Handler()))
	}
	handler.RegisterRoutes(r)
	return r
}
