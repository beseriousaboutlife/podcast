# PodcastPro Server - JWT RS256 Authentication

## Setup Instructions

### 1. Generate RSA Key Pair

The server uses RSA256 for JWT signing. Generate the key pair:

```bash
cd server
npm run generate-keys
```

Or manually:
```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

### 2. Environment Variables

Update `server/.env` with your configuration:

```env
# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/securedrive_6chh

# JWT RS256 Configuration
PRIVATE_KEY_PATH=./keys/private.pem
PUBLIC_KEY_PATH=./keys/public.pem
JWT_EXPIRES_IN=7d
JWT_ISSUER=podcastpro
JWT_AUDIENCE=podcastpro-users

# Server Configuration
PORT=5000
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

### 3. Key Security

**Important**: 
- Keep `private.pem` secure and never commit it to version control
- Add `keys/` to your `.gitignore`
- For production, store keys securely (environment variables, secret management)

### 4. Production Deployment

For Render deployment:
1. Set environment variables in Render dashboard
2. Upload private key content to `PRIVATE_KEY_CONTENT` env var
3. Upload public key content to `PUBLIC_KEY_CONTENT` env var
4. Update server code to read from env vars if files don't exist

### 5. JWT Features

- **Algorithm**: RS256 (asymmetric)
- **Expiry**: Configurable (default 7 days)
- **Session Management**: Database-backed session validation
- **Security**: Issuer/Audience validation, session revocation