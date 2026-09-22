360AI

360AI is an experimental AI framework focused on learning, reasoning, calibration, and human feedback.

Features
Multi-AI architecture
Human feedback system
Message calibration
Online deployment support
Future offline-first support
Educational source release
Philosophy

360AI is being developed around the idea of:

Maximum freedom without harm.

The project is intended for experimentation, research, and education.

Installation

git clone <repo-url>
cd 360ai
npm install

Environment Variables

Create a .env file:

EMAIL_USER=
EMAIL_PASS=
SECRET=
HOST=

NOTE: SECRET is for session/cookie and HOST is for email user and password credentials for firing off emails. Thank you

See .env.example for required variables.

Running

node appStart.js

or

pm2 start appStart.js --name 360ai

License

360AI Educational License v1.0

This project is provided for educational and non-commercial use.

Status

Current release is an active work-in-progress.

Features, APIs, file structure, and database architecture may change without notice.

Author

Tyrone Pelletier

Website: https://www.360-ai.ca
