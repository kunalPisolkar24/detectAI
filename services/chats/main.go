package main

import (
	"net/http"

	"connectrpc.com/grpchealth"
	"github.com/gin-gonic/gin"
)

func main() {
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/ready", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	path, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker())
	router.Any(path+"*any", gin.WrapH(healthHandler))

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	server := &http.Server{
		Addr:      ":8090",
		Handler:   router,
		Protocols: protocols,
	}
	if err := server.ListenAndServe(); err != nil {
		panic(err)
	}
}
