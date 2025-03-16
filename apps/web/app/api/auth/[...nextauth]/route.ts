import NextAuth from "next-auth";
import {authOptions} from "@/lib/authOptions";

/**
 * @swagger
 * /api/auth/{...nextauth}:
 *   get:
 *     summary: Handles NextAuth.js authentication requests (GET)
 *     description: |
 *       This endpoint handles various authentication flows via NextAuth.js,
 *       including sign-in, sign-out, callbacks, and session management.  It supports
 *       multiple providers (GitHub, Google, Credentials).  The specific action
 *       is determined by the `nextauth` path parameter.  This is a catch-all route.
 *     parameters:
 *       - in: path
 *         name: nextauth
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         required: true
 *         description: |
 *           The NextAuth.js action to perform (e.g., 'signin', 'signout', 'callback', 'session').
 *           This parameter is used internally by NextAuth.js.  Common values include:
 *           - `signin/github`, `signin/google`, `signin/credentials`
 *           - `callback/github`, `callback/google`, `callback/credentials`
 *           - `signout`
 *           - `session`
 *         examples:
 *            signin_github:
 *              summary: Sign in with GitHub
 *              value: ["signin", "github"]
 *            callback_google:
 *              summary: Callback from Google
 *              value: ["callback", "google"]
 *            signout:
 *              summary: Sign out
 *              value: ["signout"]
 *     responses:
 *       302:
 *         description: Redirect - NextAuth.js handles most operations via redirects.
 *       200:
 *         description: Success (for session requests, etc.) - May return user session data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       401:
 *         description: Unauthorized - User is not authenticated.
 *       404:
 *        description: Not Found
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error.
 *   post:
 *     summary: Handles NextAuth.js authentication requests (POST)
 *     description: |
 *       Similar to the GET handler, this endpoint handles authentication actions
 *       initiated via POST requests.  This is used, for example, by the
 *       Credentials provider for form submissions.  The `nextauth` path parameter
 *       determines the action.
 *     parameters:
 *       - in: path
 *         name: nextauth
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         required: true
 *         description: The NextAuth.js action. See GET request description for details.
 *         examples:
 *            signin_credentials:
 *              summary: Sign in with Credentials
 *              value: ["signin", "credentials"]
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:  # For Credentials provider
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *             required:
 *              - email
 *              - password
 *           examples:
 *             credentials_example:
 *               summary: Credentials provider example
 *               value:
 *                 email: "user@example.com"
 *                 password: "yourpassword"
 *         application/json: # For other potential providers (though less common for POST to this endpoint)
 *           schema:
 *             type: object
 *             description: Request body if used by a provider. Format varies.
 *     responses:
 *       302:
 *         description: Redirect - NextAuth.js handles most operations via redirects.
 *       200:
 *         description: OK - Successful authentication (rare, usually redirects)
 *       401:
 *         description: Unauthorized - Authentication failed (e.g., invalid credentials).
 *       404:
 *        description: Not Found
 *       400:
 *         description: Bad Request
 *       500:
 *         description: Internal server error.
 *
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       properties:
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *               format: email
 *         expires:
 *           type: string
 *           format: date-time
 *           description: Session expiration timestamp.
 *       required:
 *        - user
 *        - expires
 */

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };