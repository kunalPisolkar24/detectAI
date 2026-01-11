package logger

import (
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var Log *zap.Logger

func Init(env string) {
	config := zap.NewProductionEncoderConfig()
	config.EncodeTime = zapcore.ISO8601TimeEncoder
	encoder := zapcore.NewJSONEncoder(config)

	logLevel := zap.InfoLevel
	if env == "development" {
		logLevel = zap.DebugLevel
	}

	core := zapcore.NewCore(encoder, zapcore.AddSync(os.Stdout), logLevel)
	Log = zap.New(core, zap.AddCaller())
	zap.ReplaceGlobals(Log)
}