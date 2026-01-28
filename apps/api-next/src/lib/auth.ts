import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, genericOAuth } from "better-auth/plugins";
import { db } from "../db";

/**
 * Better Auth Configuration
 *
 * This configures authentication for the Plane API with:
 * - Email/password authentication
 * - OAuth providers (Google, GitHub, GitLab)
 * - Generic OAuth for Gitea
 * - Magic link authentication
 */
export const auth = betterAuth({
  // Database adapter
  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),

  // Base URL for auth endpoints
  basePath: "/api/auth",

  // Email/Password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Can be enabled later
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      // TODO: Implement email sending
      console.log(`[Auth] Password reset requested for ${user.email}: ${url}`);
    },
  },

  // OAuth Providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      enabled: !!process.env.GOOGLE_CLIENT_ID,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!process.env.GITHUB_CLIENT_ID,
    },
    gitlab: {
      clientId: process.env.GITLAB_CLIENT_ID || "",
      clientSecret: process.env.GITLAB_CLIENT_SECRET || "",
      issuer: process.env.GITLAB_ISSUER || "https://gitlab.com",
      enabled: !!process.env.GITLAB_CLIENT_ID,
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // Cookie configuration
  advanced: {
    cookiePrefix: "plane",
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  },

  // Custom user fields
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        unique: true,
      },
      displayName: {
        type: "string",
        required: false,
      },
      firstName: {
        type: "string",
        required: false,
      },
      lastName: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
      coverImage: {
        type: "string",
        required: false,
      },
      isOnboarded: {
        type: "boolean",
        defaultValue: false,
      },
      isActive: {
        type: "boolean",
        defaultValue: true,
      },
      isTourCompleted: {
        type: "boolean",
        defaultValue: false,
      },
      onboardingStep: {
        type: "number",
        defaultValue: 0,
      },
    },
  },

  // Account linking
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github", "gitlab", "gitea"],
    },
  },

  // Rate limiting
  rateLimit: {
    enabled: true,
    window: 60, // 1 minute
    max: 30, // 30 requests per minute
  },

  // Plugins
  plugins: [
    // Magic Link authentication
    magicLink({
      expiresIn: 300, // 5 minutes
      sendMagicLink: async ({ email, url, token }) => {
        // TODO: Implement email sending
        console.log(`[Auth] Magic link for ${email}: ${url}`);
        console.log(`[Auth] Token: ${token}`);
      },
    }),

    // Generic OAuth for Gitea and other custom providers
    genericOAuth({
      config: process.env.GITEA_CLIENT_ID
        ? [
            {
              providerId: "gitea",
              clientId: process.env.GITEA_CLIENT_ID,
              clientSecret: process.env.GITEA_CLIENT_SECRET || "",
              authorizationUrl: `${process.env.GITEA_ISSUER}/login/oauth/authorize`,
              tokenUrl: `${process.env.GITEA_ISSUER}/login/oauth/access_token`,
              scopes: ["read:user", "user:email"],
              getUserInfo: async (tokens) => {
                const response = await fetch(`${process.env.GITEA_ISSUER}/api/v1/user`, {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                  },
                });
                const profile = (await response.json()) as {
                  id: number;
                  login: string;
                  full_name?: string;
                  email?: string;
                  avatar_url?: string;
                };
                return {
                  id: String(profile.id),
                  name: profile.full_name || profile.login,
                  email: profile.email || "",
                  image: profile.avatar_url,
                  emailVerified: !!profile.email,
                };
              },
            },
          ]
        : [],
    }),
  ],

  // Trusted origins for CORS
  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3001",
    "http://localhost:3001",
    "http://localhost:4000",
  ],
});

// Export type for use in routes
export type Auth = typeof auth;

// Helper to get session from request
export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

// Helper to get user from session
export async function getUser(request: Request) {
  const session = await getSession(request);
  return session?.user ?? null;
}
