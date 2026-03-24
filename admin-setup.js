#!/usr/bin/env node

/**
 * Admin User Setup Script
 * Generates secure admin credentials for Teleka
 *
 * Usage:
 *   node admin-setup.js [email] [password]
 *
 * If no arguments provided, generates random secure password
 * If email provided but no password, generates random password for that email
 * If both provided, uses the specified credentials
 */

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import storage functions
const { initStorage, runQuery, getQuery } = require('./storage');

const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dataDir = path.join(appDataRoot, 'Teleka', 'data');

function generateSecurePassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function setupAdminUser(email = null, password = null) {
  try {
    // Initialize storage
    initStorage();

    // Use provided credentials or generate secure ones
    const adminEmail = email || process.env.ADMIN_EMAIL || 'admin@telekataxi.com';
    const adminPassword = password || process.env.ADMIN_PASSWORD;

    // If no password provided and not in env, generate a secure one
    const finalPassword = adminPassword || generateSecurePassword();

    console.log('\n🔧 TELEKA ADMIN USER SETUP');
    console.log('===========================');
    console.log(`📧 Email: ${adminEmail}`);

    const existingAdmin = await getQuery('SELECT id, password_hash FROM users WHERE email = ? AND role = ?', [adminEmail, 'admin']);

    if (!existingAdmin) {
      // Create new admin user
      const adminHash = await bcrypt.hash(finalPassword, 10);
      await runQuery(
        `INSERT INTO users (email, name, role, password_hash, created_at, updated_at)
         VALUES (?, 'Administrator', 'admin', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [adminEmail, adminHash]
      );
      console.log('✅ Admin user created successfully');
    } else {
      // Update existing admin user password
      const adminHash = await bcrypt.hash(finalPassword, 10);
      await runQuery('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adminHash, existingAdmin.id]);
      console.log('✅ Admin user password updated successfully');
    }

    console.log(`🔐 Password: ${finalPassword}`);
    console.log('\n⚠️  IMPORTANT: Save these credentials securely!');
    console.log('   This is the only time the password will be displayed.');
    console.log('\n🚀 You can now login to the admin panel at: http://localhost:3000/admin');
    console.log('===========================\n');

    return { email: adminEmail, password: finalPassword };
  } catch (error) {
    console.error('❌ Failed to setup admin user:', error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const password = args[1];

  if (email && password) {
    console.log('Using provided email and password...');
    await setupAdminUser(email, password);
  } else if (email) {
    console.log('Using provided email, generating secure password...');
    await setupAdminUser(email);
  } else {
    console.log('No credentials provided, generating secure random credentials...');
    await setupAdminUser();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { setupAdminUser, generateSecurePassword };