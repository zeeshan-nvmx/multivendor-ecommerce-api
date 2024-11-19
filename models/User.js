const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const addressSchema = new mongoose.Schema({
  name: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  country: String,
  postal_code: String,
})

// New schema for store-specific roles
const storeRoleSchema = new mongoose.Schema({
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  role: {
    type: String,
    enum: ['store_admin', 'store_manager', 'store_staff'],
    required: true,
  },
})

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  phone: {
    type: String,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  // Global role for platform-level access
  role: {
    type: String,
    enum: ['customer', 'admin', 'superadmin'],
    default: 'customer',
  },
  // Store-specific roles
  storeRoles: [storeRoleSchema],
  otp: String,
  otpExpire: Date,
  addresses: [addressSchema],
})


userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next()
  }

  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex')
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex')
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000 // 10 minutes
  return resetToken
}

// method to check if user has role in store
userSchema.methods.hasStoreRole = function (storeId, roles) {
  const storeRole = this.storeRoles.find((sr) => sr.storeId.toString() === storeId.toString())
  if (!storeRole) return false
  if (Array.isArray(roles)) {
    return roles.includes(storeRole.role)
  }
  return storeRole.role === roles
}

const User = mongoose.model('User', userSchema)

module.exports = User
