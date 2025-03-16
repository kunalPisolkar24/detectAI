import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";

const userSchema = z.object({
  firstName: z.string().min(1, { message: "First Name must be at least 1 character long" }),
  lastName: z.string().min(1, {message: "Last name must be at least 1 character long"}),
  name: z.string().min(3, { message: "Name must be at least 3 characters long" }),
  email: z.string().email({ message: "Invalid email address" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" }),
});

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Register a new user
 *     description: Creates a new user account with the provided information.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 description: The user's first name.
 *                 minLength: 1
 *               lastName:
 *                 type: string
 *                 description: The user's last name.
 *                 minLength: 1
 *               name:
 *                 type: string
 *                 description: The user's full name (can be different from first + last).
 *                 minLength: 3
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The user's email address (must be unique).
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: The user's password.
 *             required:
 *               - firstName
 *               - lastName
 *               - name
 *               - email
 *               - password
 *           example:
 *             firstName: "John"
 *             lastName: "Doe"
 *             name: "John Doe"
 *             email: "john.doe@example.com"
 *             password: "securePassword123"
 *     responses:
 *       201:
 *         description: User successfully created.
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request.  Validation errors for input data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: array
 *                   items:
 *                      type: object
 *                      properties:
 *                         message:
 *                           type: string
 *       409:
 *         description: Conflict. Email already exists.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email already in use
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal Server Error
 *
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: The user's unique ID.
 *         firstName:
 *           type: string
 *           description: The user's first name.
 *         lastName:
 *           type: string
 *           description: The user's last name.
 *         name:
 *           type: string
 *           description: The user's full name.
 *         email:
 *           type: string
 *           format: email
 *           description: The user's email address.
 *         password:
 *          type: string
 *          description: The user's hashed password
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the user was created.
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date and time the user was last updated.
 *       required:
 *          - id
 *          - firstName
 *          - lastName
 *          - name
 *          - email
 *          - createdAt
 *          - updatedAt
 */


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validationResult = userSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { name, email, password, firstName, lastName } = validationResult.data;

    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 409 }  // 409 Conflict
      );
    }

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        firstName,
        lastName
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Error during user registration:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}