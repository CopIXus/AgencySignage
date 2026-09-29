import { openDatabase, database, getUserByUsername } from './db'
import { hashPassword } from './password'

const username = process.argv[2] || 'admin'
const password = process.argv[3] || ''
if (password.length < 8) {
  console.error('Usage: npm run reset-password -- <username> <new-password>')
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
