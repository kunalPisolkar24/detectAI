import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMessage extends Document {
  role: 'user' | 'assistant';
  content: string;
  chatId: mongoose.Schema.Types.ObjectId;
  createdAt: Date;
}

export interface IMessageModel extends Model<IMessage> {}

const MessageSchema: Schema = new Schema({
  role: {
    type: String,
    required: true,
    enum: ['user', 'assistant'],
  },
  content: {
    type: String,
    required: true,
  },
  chatId: {
    type: Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

const Message: IMessageModel = mongoose.models.Message || mongoose.model<IMessage, IMessageModel>('Message', MessageSchema);

export default Message;