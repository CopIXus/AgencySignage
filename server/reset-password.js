import { database, getUserByUsername, openDatabase } from './db.js'
import { hashPassword } from './passwords.js'

const username = process.argv[2] || 'admin'
const password = process.argv[3] || ''
if (password.length < 8) {
  console.error('Usage: node server/reset-password.js <username> <new-password>')
  process.exit(1)
}
openDatabase()
const user = getUserByUsername(username)
if (!user) {
  console.error('No such user')
  process.exit(1)
}
database().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
console.log(`Password updated for ${user.username}`)
