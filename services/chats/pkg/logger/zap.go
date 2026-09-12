package logger

import (
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var Log *zap.Logger

func Init(logLevelStr string) {
	config := zap.NewProductionEncoderConfig()
	config.EncodeTime = zapcore.ISO8601TimeEncoder
	encoder := zapcore.NewJSONEncoder(config)

	level := zap.InfoLevel
	switch logLevelStr {
	case "debug":
		level = zap.DebugLevel
	case "info":
		level = zap.InfoLevel
	case "warn", "warning":
		level = zap.WarnLevel
	case "error":
		level = zap.ErrorLevel
	case "dpanic":
		level = zap.DPanicLevel
	case "panic":
		level = zap.PanicLevel
	case "fatal":
		level = zap.FatalLevel
	default:
		if logLevelStr != "" {
			// fallback to info for unknown, but try parsing zap level
			if l, err := zapcore.ParseLevel(logLevelStr); err == nil {
				level = l
			}
		}
	}

	core := zapcore.NewCore(encoder, zapcore.AddSync(os.Stdout), level)
	Log = zap.New(core, zap.AddCaller())
	zap.ReplaceGlobals(Log)
}
