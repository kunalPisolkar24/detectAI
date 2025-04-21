import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
  },
}));
vi.mock('next/server', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('next/server');
    return {
        ...actual,
        NextResponse: {
            ...actual.NextResponse,
            json: vi.fn((body, init) => ({
                json: async () => body,
                status: init?.status || 200,
                headers: new Headers(init?.headers),
                ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
                statusText: '',
                url: '',
                clone: vi.fn(),
                body: null,
                bodyUsed: false,
                arrayBuffer: vi.fn(),
                blob: vi.fn(),
                formData: vi.fn(),
                text: vi.fn(),
                redirect: vi.fn(),
                type: 'default'
            })),
        }
    };
});


const mockPrisma = prisma as unknown as {
    user: {
        findUnique: ReturnType<typeof vi.fn>,
        create: ReturnType<typeof vi.fn>
    }
};
const mockBcrypt = bcrypt as unknown as {
    hash: ReturnType<typeof vi.fn>
};
const mockNextResponse = NextResponse as unknown as {
    json: ReturnType<typeof vi.fn>
};


const createMockRequest = (body: unknown): NextRequest => {
    const request = new NextRequest('http://localhost/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
    });
    // Ensure the json method returns the original body for parsing within the route handler
    request.json = async () => body as any;
    return request;
};


describe('API Route: /api/auth/register', () => {
    const validUserData = {
        firstName: 'Test',
        lastName: 'User',
        name: 'testuser', // Still needed by schema
        email: 'test@example.com',
        password: 'password123',
    };
    const hashedPassword = 'hashed_password_string';
    const createdUserResponse = {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        createdAt: new Date(),
     };


    beforeEach(() => {
        vi.resetAllMocks();
        mockBcrypt.hash.mockResolvedValue(hashedPassword);
        mockNextResponse.json.mockImplementation((body, init) => ({
             json: async () => body,
             status: init?.status || 200,
             headers: new Headers(init?.headers),
        }) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register a new user successfully', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create.mockResolvedValue(createdUserResponse);

        const request = createMockRequest(validUserData);
        await POST(request);

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10);
        expect(mockPrisma.user.create).toHaveBeenCalledWith({
            data: {
                 name: `${validUserData.firstName} ${validUserData.lastName}`,
                 email: validUserData.email,
                 password: hashedPassword,
                 firstName: validUserData.firstName,
                 lastName: validUserData.lastName,
             },
             select: {
                 id: true,
                 name: true,
                 email: true,
                 firstName: true,
                 lastName: true,
                 createdAt: true,
             }
        });
        expect(mockNextResponse.json).toHaveBeenCalledWith(createdUserResponse, { status: 201 });

    });

    it('should return 400 for invalid input data', async () => {
        const invalidData = { ...validUserData, email: 'not-an-email', password: 'short' };
        const request = createMockRequest(invalidData);
        await POST(request);

        expect(mockNextResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: "Invalid input",
                details: expect.objectContaining({
                   email: expect.any(Array),
                   password: expect.any(Array),
                }),
            }),
            { status: 400 }
        );

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockBcrypt.hash).not.toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 409 if email is already in use', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: validUserData.email, name: 'Existing User', password: 'somehash' } as any); // Simulate existing user

        const request = createMockRequest(validUserData);
        await POST(request);

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10); // Hash happens before findUnique check
        expect(mockNextResponse.json).toHaveBeenCalledWith(
             { error: 'Email already in use' },
             { status: 409 }
         );
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 500 if bcrypt hashing fails', async () => {
        const bcryptError = new Error('Hashing failed');
        mockBcrypt.hash.mockRejectedValue(bcryptError);

        const request = createMockRequest(validUserData);
        await POST(request);

        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10);
        expect(mockNextResponse.json).toHaveBeenCalledWith(
             { error: "An unexpected error occurred during registration." },
             { status: 500 }
         );
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 500 if prisma findUnique fails', async () => {
        const prismaError = new Error('DB connection error');
        mockPrisma.user.findUnique.mockRejectedValue(prismaError);

        const request = createMockRequest(validUserData);
        await POST(request);


        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10);
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockNextResponse.json).toHaveBeenCalledWith(
             { error: "An unexpected error occurred during registration." },
             { status: 500 }
         );
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });


    it('should return 500 if prisma create fails', async () => {
        const prismaError = new Error('DB write error');
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create.mockRejectedValue(prismaError);

        const request = createMockRequest(validUserData);
        await POST(request);

        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10);
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockPrisma.user.create).toHaveBeenCalled();
        expect(mockNextResponse.json).toHaveBeenCalledWith(
             { error: "An unexpected error occurred during registration." },
             { status: 500 }
         );
    });

     it('should return 500 if request body parsing fails', async () => {
         const request = new NextRequest('http://localhost/api/auth/register', {
             method: 'POST',
             body: '{"malformed json",', // Invalid JSON
             headers: { 'Content-Type': 'application/json' }
         });
          // Mock the json method to throw an error, simulating parsing failure
         request.json = async () => { throw new SyntaxError("Unexpected token") };

         await POST(request);

         expect(mockNextResponse.json).toHaveBeenCalledWith(
             { error: "An unexpected error occurred during registration." },
             { status: 500 }
         );
         expect(mockBcrypt.hash).not.toHaveBeenCalled();
         expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
         expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
});