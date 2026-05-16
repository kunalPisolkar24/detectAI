import express from 'express';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({
  transport: {
    target: 'pino-pretty'
  }
});

const HTTP_PORT = process.env.HTTP_PORT || 8000;
const GRPC_PORT = process.env.GRPC_PORT || 50051;

// --- HTTP Mocks ---
const app = express();
app.use(express.json());

// Document Parser Mock
app.post('/extract', (req, res) => {
  logger.info('HTTP: POST /extract');
  res.json({ text: 'Sample extracted text from mock server for load testing purposes.' });
});

// Payment Gateway Mock
app.post('/internal/events', (req, res) => {
  logger.info('HTTP: POST /internal/events');
  res.json({ success: true });
});

app.listen(HTTP_PORT, () => {
  logger.info(`HTTP Mock Server listening on port ${HTTP_PORT}`);
});

// --- gRPC Mocks ---
const PROTO_DIR = path.resolve(__dirname, '../../../../lib/shared/proto');

const loadProto = (filename) => {
  const packageDefinition = protoLoader.loadSync(path.join(PROTO_DIR, filename), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDefinition);
};

const aiProto = loadProto('ai_service.proto');
const chatProto = loadProto('chat_service.proto');

const server = new grpc.Server();

// AIService Implementation
server.addService(aiProto.aidetection.AIService.service, {
  Detect: (call, callback) => {
    logger.info('gRPC: AIService.Detect');
    callback(null, {
      model_name: 'mock-model-v1',
      label: 'Human',
      is_ai_generated: false,
      confidence_score: 0.98,
      human_confidence: 0.99,
      ai_confidence: 0.01,
      highlight_spans: []
    });
  },
  AnalyzeDocument: (call) => {
    logger.info('gRPC: AIService.AnalyzeDocument (Streaming)');
    call.write({ started: { total_chars: 1000, total_chunks: 2 } });
    
    setTimeout(() => {
      call.write({ progress: { processed_chunks: 1, total_chunks: 2 } });
    }, 100);

    setTimeout(() => {
      call.write({ progress: { processed_chunks: 2, total_chunks: 2 } });
      call.write({ final: {
        model_name: 'mock-model-v1',
        label: 'AI',
        is_ai_generated: true,
        confidence_score: 0.95,
        highlight_spans: [{ char_start: 0, char_end: 100, ai_confidence: 0.99 }]
      }});
      call.end();
    }, 200);
  }
});

// ChatService Implementation
server.addService(chatProto.chat.ChatService.service, {
  CreateChat: (call, callback) => {
    logger.info('gRPC: ChatService.CreateChat');
    callback(null, { chat_id: 'mock-chat-' + Date.now() });
  },
  GetChat: (call, callback) => {
    logger.info('gRPC: ChatService.GetChat');
    callback(null, { id: call.request.chat_id, user_id: 'mock-user', title: 'Mock Chat', created_at: Date.now(), updated_at: Date.now() });
  },
  GetUserChats: (call, callback) => {
    logger.info('gRPC: ChatService.GetUserChats');
    callback(null, { chats: [{ id: 'mock-chat-1', title: 'Mock Chat 1', updated_at: Date.now() }] });
  },
  RenameChat: (call, callback) => {
    logger.info('gRPC: ChatService.RenameChat');
    callback(null, { success: true });
  },
  DeleteChat: (call, callback) => {
    logger.info('gRPC: ChatService.DeleteChat');
    callback(null, { success: true });
  },
  SaveMessage: (call, callback) => {
    logger.info('gRPC: ChatService.SaveMessage');
    callback(null, { message_id: 'mock-msg-' + Date.now(), timestamp: Date.now() });
  },
  GetChatHistory: (call, callback) => {
    logger.info('gRPC: ChatService.GetChatHistory');
    callback(null, { messages: [], has_more: false });
  }
});

server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    logger.error(`Failed to bind gRPC server: ${err.message}`);
    return;
  }
  logger.info(`gRPC Mock Server listening on port ${port}`);
});
