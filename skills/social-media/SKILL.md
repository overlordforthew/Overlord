# Skill: Social Media

## Scope
Content creation, scheduling, and posting to social media platforms.

## Current Status
Framework ready — API keys needed for posting. Content creation works now.

## Available Tools

### generate-post.py
Generate social media content optimized for each platform.
```bash
python3 /app/skills/social-media/generate-post.py --platform twitter --topic "meditation benefits"
python3 /app/skills/social-media/generate-post.py --platform instagram --topic "workout motivation"
python3 /app/skills/social-media/generate-post.py --platform youtube --topic "guided sleep meditation"
```

## Content Guidelines by Platform

### Twitter/X
- Max 280 chars, punchy, hashtags at end
- Thread format for longer content (numbered tweets)
- Engagement hooks: questions, polls, hot takes

### Instagram
- Carousel posts: 5-10 slides with key points
- Caption: hook line + value + CTA + hashtags (30 max)
- Stories: polls, questions, behind-the-scenes

### YouTube
- Title: keyword-rich, under 60 chars, curiosity gap
- Description: first 2 lines are critical (shown in search)
- Tags: mix of broad + specific, 15-20 tags
- Thumbnail text: 3-5 words max, high contrast

### LinkedIn
- Professional tone, industry insights
- First line is the hook (shown before "see more")
- Tag relevant people/companies

## Future: API Integration
When API keys are configured:
- Twitter: OAuth 2.0 via tweepy
- Instagram: Meta Graph API
- YouTube: Google API (already have GOOGLE_API_KEY)

## When to Use
- User asks to create social media content
- User wants help with YouTube titles, descriptions, thumbnails
- User wants content repurposed across platforms
