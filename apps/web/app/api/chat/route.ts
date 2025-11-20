import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import dbConnect from "@/lib/mongoose";
import Chat from "@/models/Chat";
import Message from "@/models/Message";

export const dynamic = 'force-dynamic';
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
        await dbConnect();
        const chats = await Chat.find({ userId: session.user.id }).sort({ updatedAt: -1 });
        return NextResponse.json(chats);
    } catch (error) {
        console.error("API_CHAT_GET_ERROR:", error);
        return NextResponse.json({ error: "Failed to fetch chats." }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
        const { firstMessage } = await request.json();
        if (!firstMessage || typeof firstMessage !== 'string' || firstMessage.trim().length === 0) {
            return NextResponse.json({ error: 'A valid starting message is required.' }, { status: 400 });
        }

        await dbConnect();

        const count = await Chat.countDocuments({ userId: session.user.id });
        const title = `Analysis ${count + 1}`;

        const newChat = new Chat({
            userId: session.user.id,
            title: title,
        });
        await newChat.save();

        const newMessage = new Message({
            chatId: newChat._id,
            role: 'user',
            content: firstMessage.trim(),
        });
        await newMessage.save();
        return NextResponse.json({ chat: newChat, firstMessage: newMessage }, { status: 201 });
    } catch (error) {
        console.error("API_CHAT_POST_ERROR:", error);
        return NextResponse.json({ error: "Failed to create a new chat." }, { status: 500 });
    }
}