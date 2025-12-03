# 📧 Email Configuration Guide for Teleka Taxi

## Problem: Gmail emails not receiving admin notifications

If you're not receiving email notifications when customers book via www.telekataxi.com, follow these steps to fix it.

## Current Configuration Check

Your `.env` file has:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=telekataxi@gmail.com
SMTP_PASS=qigbdummobyfndlt
ADMIN_EMAILS=emouisaac1@gmail.com
```

## Step 1: Verify Gmail App Password is Active

Gmail doesn't allow regular passwords over SMTP anymore. You MUST use an **App Password**:

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (if not already enabled)
3. Go to [App passwords](https://myaccount.google.com/apppasswords)
4. Select **Mail** and **Windows Computer** (or your device)
5. Google will generate a 16-character password
6. **Copy this password and update SMTP_PASS** in your `.env` file

⚠️ **The current SMTP_PASS in your .env might be incorrect. Replace it with a fresh app password from Google.**

## Step 2: Test Email Configuration

Once you've updated the password, restart your server and test the email:

### Method 1: Using the Test API Endpoint (Recommended)

```bash
curl -X POST http://localhost:3000/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"to":"emouisaac1@gmail.com"}'
```

Or use the browser by visiting:
```
http://localhost:3000/api/email/test
```

This will:
- ✓ Send a test email to your admin address
- ✓ Log detailed diagnostics if it fails
- ✓ Show you the exact error in the response

### Method 2: Create a Test Booking

1. Go to your Teleka website (http://www.telekataxi.com)
2. Create a test booking
3. Check your email (emouisaac1@gmail.com)
4. If you don't receive it, check server logs for the error

## Common Issues & Solutions

### ❌ Error: "Authentication failed" or "535 5.7.8"

**Solution:** Your app password is wrong or not regenerated
1. Delete the current SMTP_PASS from `.env`
2. Generate a NEW app password from [Google Account](https://myaccount.google.com/apppasswords)
3. Copy the 16-character password (without spaces) to SMTP_PASS
4. Restart the server
5. Test again

### ❌ Error: "ENOTFOUND" or connection refused

**Solution:** SMTP_HOST or SMTP_PORT is wrong
- For Gmail, use: `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`
- Check your `.env` has the correct values

### ❌ No emails received, but logs say "success"

**Solution:** Check Gmail's Spam folder
1. Check your [Gmail spam folder](https://mail.google.com/mail/u/0/#spam)
2. If test emails are there, your configuration is correct but Gmail is filtering them
3. Mark them as "Not Spam" to train Gmail

### ❌ Error: "ADMIN_EMAILS not configured"

**Solution:** Add the email address to `.env`
```
ADMIN_EMAILS=emouisaac1@gmail.com
```

Multiple admins? Separate with commas:
```
ADMIN_EMAILS=email1@gmail.com,email2@gmail.com
```

## Step 3: Verify All Bookings Send Emails

Once the test email works:

1. **Test via the client website** (www.telekataxi.com)
   - Create a booking
   - Check your admin email within 5 seconds
   - You should see the notification

2. **Monitor server logs** for email status
   - Look for `[email] ✓ SUCCESS` (good)
   - Look for `[email] ✗ FAILED` (something's wrong)

## How the System Works

When a customer creates a booking:

1. ✅ Booking is saved
2. ✅ Server reads `ADMIN_EMAILS` from `.env`
3. ✅ Server connects to Gmail SMTP
4. ✅ Email is sent to each admin email
5. ✅ Confirmation logged in server console

If any step fails, you'll see detailed error logs.

## Debug Commands

If you're still having issues, run these commands to check:

### Check if .env is loaded correctly
```bash
node -e "require('dotenv').config(); console.log('ADMIN_EMAILS:', process.env.ADMIN_EMAILS)"
```

### Check server logs for email errors
```bash
# Look for [email] messages
grep "\[email\]" server.log
```

## Quick Summary

**To fix Gmail notifications:**

1. Get a fresh **App Password** from [Google Account](https://myaccount.google.com/apppasswords)
2. Update `SMTP_PASS` in `.env` with the new password
3. Restart your server
4. Test using `/api/email/test` endpoint
5. If successful, all bookings will send emails automatically

**Questions?** Check the server logs for `[email]` prefixed messages - they'll tell you exactly what's wrong.
