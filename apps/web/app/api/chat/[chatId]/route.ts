import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import dbConnect from "@/lib/mongoose";
import Chat from "@/models/Chat";
import Message from "@/models/Message";

export const dynamic = 'force-dynamic';
async function verifyChatOwnership(chatId: string, userId: string) {
    if (!mongoose.Types.ObjectId.isValid(chatId)) return null;
    await dbConnect();
    const chat = await Chat.findOne({ _id: chatId, userId: userId });
    return chat;
}

export async function GET(
    request: NextRequest,
    context: any 
) {
    const { chatId } = context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const chat = await verifyChatOwnership(chatId, session.user.id);
    if (!chat) {
        return NextResponse.json({ error: "Chat not found or access denied." }, { status: 404 });
    }

    return NextResponse.json(chat);
}

export async function PUT(
    request: NextRequest,
    context: any
) {
    const { chatId } = context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const chat = await verifyChatOwnership(chatId, session.user.id);
    if (!chat) {
        return NextResponse.json({ error: "Chat not found or access denied." }, { status: 404 });
    }

    try {
        const { title } = await request.json();
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return NextResponse.json({ error: "A valid title is required." }, { status: 400 });
        }

        chat.title = title.trim();
        await chat.save();

        return NextResponse.json(chat);
    } catch (error) {
        console.error(`API_CHAT_ID_PUT_ERROR:`, error);
        return NextResponse.json({ error: "Failed to update chat title." }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    context: any
) {
    const { chatId } = context.params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const chat = await verifyChatOwnership(chatId, session.user.id);
    if (!chat) {
        return NextResponse.json({ error: "Chat not found or access denied." }, { status: 404 });
    }

    try {
        await Message.deleteMany({ chatId: chat._id });
        await Chat.deleteOne({ _id: chat._id });

        return NextResponse.json({ message: "Chat and associated messages deleted successfully." });
    } catch (error) {
        console.error(`API_CHAT_ID_DELETE_ERROR:`, error);
        return NextResponse.json({ error: "Failed to delete chat." }, { status: 500 });
    }
}