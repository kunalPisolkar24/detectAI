// apps/web/api/auth/register/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
    user: {
        findUnique: ReturnType<typeof vi.fn>,
        create: ReturnType<typeof vi.fn>
    }
};
const mockBcrypt = bcrypt as unknown as {
    hash: ReturnType<typeof vi.fn>
};


const createMockRequest = (body: any): NextRequest => {
    const request = new NextRequest('http://localhost/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
    });
    request.json = async () => body;
    return request;
};

describe('API Route: /api/auth/register', () => {
    const validUserData = {
        firstName: 'Test',
        lastName: 'User',
        name: 'testuser',
        email: 'test@example.com',
        password: 'password123',
    };
    const hashedPassword = 'hashed_password_string';
    const createdUser = { ...validUserData, id: 'user-123', password: hashedPassword };

    beforeEach(() => {
        vi.resetAllMocks();
        mockBcrypt.hash.mockResolvedValue(hashedPassword);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register a new user successfully', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create.mockResolvedValue(createdUser);

        const request = createMockRequest(validUserData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body).toEqual(createdUser);
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockBcrypt.hash).toHaveBeenCalledWith(validUserData.password, 10);
        expect(mockPrisma.user.create).toHaveBeenCalledWith({
            data: { ...validUserData, password: hashedPassword },
        });
    });

    it('should return 400 for invalid input data', async () => {
        const invalidData = { ...validUserData, email: 'not-an-email' };
        const request = createMockRequest(invalidData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBeDefined();
        expect(body.error[0].path).toContain('email');
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockBcrypt.hash).not.toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 409 if email is already in use', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(createdUser); // Simulate existing user

        const request = createMockRequest(validUserData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body).toEqual({ error: 'Email already in use' });
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: validUserData.email } });
        expect(mockBcrypt.hash).toHaveBeenCalled(); // Hash happens before findUnique check
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 500 if bcrypt hashing fails', async () => {
        const bcryptError = new Error('Hashing failed');
        mockBcrypt.hash.mockRejectedValue(bcryptError);
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const request = createMockRequest(validUserData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Internal Server Error' });
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled(); // Fails before findUnique
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should return 500 if prisma findUnique fails', async () => {
        const prismaError = new Error('DB connection error');
        mockPrisma.user.findUnique.mockRejectedValue(prismaError);

        const request = createMockRequest(validUserData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Internal Server Error' });
        expect(mockBcrypt.hash).toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });


    it('should return 500 if prisma create fails', async () => {
        const prismaError = new Error('DB write error');
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create.mockRejectedValue(prismaError);

        const request = createMockRequest(validUserData);
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Internal Server Error' });
        expect(mockBcrypt.hash).toHaveBeenCalled();
        expect(mockPrisma.user.findUnique).toHaveBeenCalled();
    });

     it('should return 500 if request body is invalid json', async () => {
         const request = new NextRequest('http://localhost/api/auth/register', {
             method: 'POST',
             body: 'not json',
             headers: { 'Content-Type': 'application/json' }
         });

         const response = await POST(request);
         const body = await response.json();

         expect(response.status).toBe(500);
         expect(body).toEqual({ error: 'Internal Server Error' });
         expect(mockBcrypt.hash).not.toHaveBeenCalled();
         expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
         expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
});