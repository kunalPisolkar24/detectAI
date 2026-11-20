// Seeds the accounts the load scripts sign in with.
//
// Registration is a server action, not an HTTP route, so the rig needs the
// rows in place before a script can exercise the credentials callback. The
// free account carries no subscription, the premium one an ACTIVE
// subscription - that is what the app reads when it decides whether a
// session is premium.

import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL
const PASSWORD = process.env.LOAD_USER_PASSWORD || 'LoadTest123!'

const ACCOUNTS = [
  {
    id: 'load_free_user',
    email: process.env.FREE_USER_EMAIL || 'load-free@detectai.test',
    firstName: 'Load',
    lastName: 'Free',
    premium: false,
  },
  {
    id: 'load_premium_user',
    email: process.env.PREMIUM_USER_EMAIL || 'load-premium@detectai.test',
    firstName: 'Load',
    lastName: 'Premium',
    premium: true,
  },
]

async function seedAccount(pool, account, passwordHash) {
  const { rows } = await pool.query(
    `INSERT INTO "User" ("id", "name", "email", "firstName", "lastName", "password", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT ("email") DO UPDATE SET "password" = EXCLUDED."password", "updatedAt" = NOW()
     RETURNING "id"`,
    [account.id, `${account.firstName} ${account.lastName}`, account.email, account.firstName, account.lastName, passwordHash],
  )

  const userId = rows[0].id

  if (account.premium) {
    await pool.query(
      `INSERT INTO "Subscription" ("id", "userId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'ACTIVE', NOW(), NOW())
       ON CONFLICT ("userId") DO UPDATE SET "status" = 'ACTIVE', "updatedAt" = NOW()`,
      [`${userId}_subscription`, userId],
    )
  } else {
    await pool.query(`DELETE FROM "Subscription" WHERE "userId" = $1`, [userId])
  }

  console.log(`seeded ${account.email} (${account.premium ? 'premium' : 'free'})`)
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }

  const pool = new Pool({ connectionString: DATABASE_URL })
  try {
    // The same cost the register action uses, so the login path does the
    // amount of work it would do in production.
    const passwordHash = await bcrypt.hash(PASSWORD, 10)
    for (const account of ACCOUNTS) {
      await seedAccount(pool, account, passwordHash)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('seeding failed:', error)
  process.exit(1)
})
