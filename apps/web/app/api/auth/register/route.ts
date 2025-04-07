// import prisma from "@/lib/prisma";
// import { NextResponse } from "next/server";
// import { z } from "zod";
// import bcrypt from "bcrypt";

// const userSchema = z.object({
//   firstName: z.string().min(1, { message: "First Name must be at least 1 character long" }),
//   lastName: z.string().min(1, {message: "Last name must be at least 1 character long"}),
//   name: z.string().min(3, { message: "Name must be at least 3 characters long" }),
//   email: z.string().email({ message: "Invalid email address" }),
//   password: z
//     .string()
//     .min(8, { message: "Password must be at least 8 characters long" }),
// });

// export async function POST(request: Request) {
//   try {
//     const body = await request.json();
//     const validationResult = userSchema.safeParse(body);

//     if (!validationResult.success) {
//       return NextResponse.json(
//         { error: validationResult.error.errors },
//         { status: 400 }
//       );
//     }

//     const { name, email, password, firstName, lastName } = validationResult.data;

//     const hashedPassword = await bcrypt.hash(password, 10);

//     // Check if user already exists
//     const existingUser = await prisma.user.findUnique({
//       where: {
//         email,
//       },
//     });

//     if (existingUser) {
//       return NextResponse.json(
//         { error: "Email already in use" },
//         { status: 409 }
//       );
//     }

//     const newUser = await prisma.user.create({
//       data: {
//         name,
//         email,
//         password: hashedPassword,
//         firstName,
//         lastName
//       },
//     });

//     return NextResponse.json(newUser, { status: 201 });
//   } catch (error) {
//     console.error("Error during user registration:", error);
//     return NextResponse.json(
//       { error: "Internal Server Error" },
//       { status: 500 }
//     );
//   }
// }

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validationResult = userSchema.safeParse(body);

    if (!validationResult.success) {
      // Flatten errors for easier frontend handling if desired
      const formattedErrors = validationResult.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Invalid input", details: formattedErrors },
        { status: 400 }
      );
    }

    const { name, email, password, firstName, lastName } = validationResult.data;

    const hashedPassword = await bcrypt.hash(password, 10);

    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 409 } // 409 Conflict is appropriate here
      );
    }

    const newUser = await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`, // Use combined name from registration
        email,
        password: hashedPassword,
        firstName,
        lastName
      },
      // Select only non-sensitive fields to return
      select: {
         id: true,
         name: true,
         email: true,
         firstName: true,
         lastName: true,
         createdAt: true,
      }
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Error during user registration:", error);
    // Avoid leaking sensitive error details in production
    return NextResponse.json(
      { error: "An unexpected error occurred during registration." },
      { status: 500 }
    );
  }
}