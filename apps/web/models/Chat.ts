import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChat extends Document {
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChatModel extends Model<IChat> {}

const ChatSchema: Schema = new Schema({
  userId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

const Chat: IChatModel = mongoose.models.Chat || mongoose.model<IChat, IChatModel>('Chat', ChatSchema);

export default Chat;