# Deployment Checklist

## Pre-Deploy
- [ ] All changes committed and pushed
- [ ] No sensitive data in code (API keys, passwords)
- [ ] Dockerfile builds successfully locally
- [ ] Environment variables set in Coolify

## Deploy
- [ ] Push to main branch (triggers Coolify webhook)
- [ ] Monitor Coolify build logs
- [ ] Verify container starts successfully

## Post-Deploy
- [ ] Check live URL responds correctly
- [ ] Check container logs for errors: `docker logs <name> --tail 50`
- [ ] Verify database connections (if applicable)
- [ ] Test critical functionality
- [ ] Update STATUS.md
- [ ] Log in CHANGELOG.md
