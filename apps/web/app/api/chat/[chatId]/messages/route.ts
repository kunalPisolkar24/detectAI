import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import dbConnect from "@/lib/mongoose";
import Chat from "@/models/Chat";
import Message from "@/models/Message";

export const dynamic = 'force-dynamic';
export async function GET(
    request: NextRequest,
    context: any
) {
    const { chatId } = context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return NextResponse.json({ error: "Invalid Chat ID." }, { status: 400 });
    }

    await dbConnect();
    const chat = await Chat.findOne({ _id: chatId, userId: session.user.id });
    if (!chat) {
        return NextResponse.json({ error: "Chat not found or access denied." }, { status: 404 });
    }

    const messages = await Message.find({ chatId: chatId }).sort({ createdAt: 'asc' });
    return NextResponse.json(messages);
}

export async function POST(
    request: NextRequest,
    context: any
) {
    const { chatId } = context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return NextResponse.json({ error: "Invalid Chat ID." }, { status: 400 });
    }

    await dbConnect();
    const chat = await Chat.findOne({ _id: chatId, userId: session.user.id });
    if (!chat) {
        return NextResponse.json({ error: "Chat not found or access denied." }, { status: 404 });
    }

    try {
        const { role, content } = await request.json();
        const validRoles = ['user', 'assistant'];
        if (!role || !validRoles.includes(role) || !content || typeof content !== 'string' || content.trim().length === 0) {
            return NextResponse.json({ error: "Valid role and content are required." }, { status: 400 });
        }

        const newMessage = new Message({
            chatId: chatId,
            role: role,
            content: content.trim(),
        });
        await newMessage.save();

        chat.updatedAt = new Date();
        await chat.save();

        return NextResponse.json(newMessage, { status: 201 });
    } catch (error) {
        console.error("API_MESSAGES_POST_ERROR:", error);
        return NextResponse.json({ error: "Failed to add message." }, { status: 500 });
    }
}