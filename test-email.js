#!/usr/bin/env node
/**
 * Quick Gmail SMTP test script
 * Run: node test-email.js
 * 
 * This script will:
 * 1. Load environment variables from .env
 * 2. Try to connect to Gmail SMTP
 * 3. Send a test email
 * 4. Report success or detailed errors
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('\n📧 Teleka Email Configuration Test\n');
  console.log('Configuration loaded:');
  console.log('  SMTP_HOST:', process.env.SMTP_HOST);
  console.log('  SMTP_PORT:', process.env.SMTP_PORT);
  console.log('  SMTP_USER:', process.env.SMTP_USER);
  console.log('  SMTP_PASS:', process.env.SMTP_PASS ? '✓ SET' : '✗ NOT SET');
  console.log('  ADMIN_EMAILS:', process.env.ADMIN_EMAILS);
  
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('\n❌ ERROR: Missing SMTP configuration in .env');
    console.error('   Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
    process.exit(1);
  }

  if (!process.env.ADMIN_EMAILS) {
    console.error('\n❌ ERROR: Missing ADMIN_EMAILS in .env');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    console.log('\n🔌 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✓ SMTP connection verified!\n');

    const testEmail = process.env.ADMIN_EMAILS.split(',')[0].trim();
    
    console.log('📤 Sending test email to:', testEmail);
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: testEmail,
      subject: '[TEST] Teleka Email Configuration',
      text: 'This is a test email. If you received this, your email configuration is working!',
      html: '<p>This is a <strong>test email</strong>.</p><p>If you received this, your Teleka email configuration is working! ✓</p>'
    });

    console.log('✓ Email sent successfully!');
    console.log('  Message ID:', info.messageId);
    console.log('  Response:', info.response);
    console.log('\n✅ Your Gmail SMTP configuration is working correctly!');
    console.log('\nNext steps:');
    console.log('1. Check your inbox (and spam folder) for the test email');
    console.log('2. Start your server: npm start');
    console.log('3. Create a test booking on the website');
    console.log('4. Verify the booking notification email arrives\n');
    
  } catch (error) {
    console.error('\n❌ EMAIL TEST FAILED\n');
    console.error('Error:', error.message);
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.error('\n🔧 AUTHENTICATION ERROR');
      console.error('Your Gmail app password might be:');
      console.error('  • Wrong or expired');
      console.error('  • Not configured with 2FA enabled');
      console.error('  • Not regenerated recently');
      console.error('\nTo fix:');
      console.error('1. Go to https://myaccount.google.com/apppasswords');
      console.error('2. Select "Mail" and "Windows Computer"');
      console.error('3. Copy the 16-character password');
      console.error('4. Update SMTP_PASS in .env with the new password');
      console.error('5. Run this test again: node test-email.js');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('\n🔧 CONNECTION ERROR');
      console.error('Check your .env file:');
      console.error('  SMTP_HOST=' + process.env.SMTP_HOST);
      console.error('  SMTP_PORT=' + process.env.SMTP_PORT);
      console.error('\nFor Gmail, use:');
      console.error('  SMTP_HOST=smtp.gmail.com');
      console.error('  SMTP_PORT=587');
    } else {
      console.error('\n🔍 Response Code:', error.responseCode);
      console.error('Code:', error.code);
      if (error.response) console.error('Response:', error.response);
    }
    
    process.exit(1);
  }
}

testEmail().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
