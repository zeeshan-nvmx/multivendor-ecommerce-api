const User = require('../models/User')
const generateToken = require('../utils/generateToken')
const sendEmail = require('../utils/sendEmail')
const jwt = require('jsonwebtoken')
const Joi = require('joi')

// Validation schemas 
const registerSchema = Joi.object({
  name: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  phone: Joi.string()
    .pattern(/^(?:\+?88)?01\d{9}$/)
    .optional()
    .allow('', null),
  password: Joi.string().min(6).required(),
  // New store-specific fields
  storeId: Joi.string().length(24).optional(),
  storeRole: Joi.string().valid('store_admin', 'store_manager', 'store_staff').when('storeId', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
}).options({ abortEarly: false })

const loginSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().min(6).required(),
  // New store field
  storeId: Joi.string().length(24).optional()
}).options({ abortEarly: false })


const forgotPasswordSchema = Joi.object({
  identifier: Joi.string().required(),
}).options({ abortEarly: false })

const verifyOTPSchema = Joi.object({
  otp: Joi.string().length(6).required(),
}).options({ abortEarly: false })

const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).required(),
  otp: Joi.string().length(6).required(),
}).options({ abortEarly: false })

const updateProfileSchema = Joi.object({
  name: Joi.string().min(3).max(50).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string()
    .pattern(/^[0-9]{10,15}$/)
    .optional()
    .allow(''),
}).options({ abortEarly: false })

const addAddressSchema = Joi.object({
  name: Joi.string().min(3).max(50).required(),
  line1: Joi.string().min(3).max(100).required(),
  line2: Joi.string().min(3).max(100).optional(),
  city: Joi.string().min(3).max(50).required(),
  state: Joi.string().min(2).max(50).optional(),
  country: Joi.string().min(2).max(50).required(),
  postal_code: Joi.string().min(3).max(20).required(),
}).options({ abortEarly: false })

const register = async (req, res) => {
  const { error } = registerSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { name, email, phone, password, storeId, storeRole } = req.body

  try {
    const userExists = await User.findOne({
      $or: [{ email }, ...(phone ? [{ phone }] : [])],
    })

    if (userExists) {
      const field = userExists.email === email ? 'email' : 'phone'
      return res.status(400).json({ message: `User already exists with this ${field}` })
    }

    // Create user with store role if provided
    const userData = {
      name,
      email,
      phone,
      password,
      role: 'customer'
    }

    if (storeId && storeRole) {
      userData.storeRoles = [{
        storeId,
        role: storeRole
      }]
    }

    const user = await User.create(userData)

    if (user) {
      const tokenData = {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        storeRoles: user.storeRoles
      }
      const token = generateToken(tokenData)
      return res.status(201).json({ message: 'User created successfully', data: { user: tokenData, token } })
    } else {
      return res.status(400).json({ message: 'Invalid user data' })
    }
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const login = async (req, res) => {
  const { error } = loginSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { identifier, password, storeId } = req.body

  try {
    const isEmail = identifier.includes('@')
    const user = await User.findOne(isEmail ? { email: identifier } : { phone: identifier })

    if (user && (await user.matchPassword(password))) {
      // Check store access if storeId is provided
      if (storeId) {
        const hasStoreAccess = user.storeRoles.some(
          role => role.storeId.toString() === storeId
        ) || ['admin', 'superadmin'].includes(user.role)

        if (!hasStoreAccess) {
          return res.status(403).json({ 
            message: 'You do not have access to this store' 
          })
        }
      }

      const tokenData = {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        storeRoles: user.storeRoles,
        addresses: user.addresses
      }
      const token = generateToken(tokenData)
      return res.json({ message: 'User authenticated', data: { user: tokenData, token } })
    } else {
      return res.status(401).json({ message: 'Invalid credentials' })
    }
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}


const forgotPassword = async (req, res) => {
  const { error } = forgotPasswordSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { identifier } = req.body

  try {
    const isEmail = identifier.includes('@')
    const user = await User.findOne(isEmail ? { email: identifier } : { phone: identifier })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    user.otp = otp
    user.otpExpire = Date.now() + 10 * 60 * 1000

    await user.save({ validateBeforeSave: false })

    const message = `
      <h1>OTP for Password Reset</h1>
      <p>Your OTP is: <strong>${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
    `

    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset OTP',
        text: message,
      })

      return res.status(201).json({ message: 'An OTP was sent to your email' })
    } catch (error) {
      user.otp = undefined
      user.otpExpire = undefined
      await user.save({ validateBeforeSave: false })
      return res.status(500).json({ message: 'OTP could not be sent', error: error.message })
    }
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}


const verifyOTP = async (req, res) => {
  const { error } = verifyOTPSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { otp } = req.body

  try {
    const user = await User.findOne({
      otp,
      otpExpire: { $gt: Date.now() },
    })

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired OTP' })
    }

    return res.status(200).json({ message: 'OTP verified successfully' })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}


const resetPassword = async (req, res) => {
  const { error } = resetPasswordSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { newPassword, otp } = req.body

  try {
    const user = await User.findOne({
      otp,
      otpExpire: { $gt: Date.now() },
    })

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired OTP' })
    }

    user.password = newPassword
    user.otp = undefined
    user.otpExpire = undefined

    await user.save()

    return res.status(200).json({ message: 'Password updated successfully' })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const updateProfile = async (req, res) => {
  const { error } = updateProfileSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const { name, email, phone } = req.body
  const storeId = req.headers['x-store-id']

  try {
    const user = await User.findById(req.user.id)

    // Check store access if store context exists
    if (storeId) {
      const hasStoreAccess = user.storeRoles.some(
        role => role.storeId.toString() === storeId
      ) || ['admin', 'superadmin'].includes(user.role)

      if (!hasStoreAccess) {
        return res.status(403).json({ 
          message: 'You do not have access to this store' 
        })
      }
    }

    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: user._id } })
      if (emailExists) {
        return res.status(400).json({ message: 'Email already in use' })
      }
      user.email = email
    }

    if (phone && phone !== user.phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: user._id } })
      if (phoneExists) {
        return res.status(400).json({ message: 'Phone number already in use' })
      }
      user.phone = phone
    }

    if (name) user.name = name

    await user.save()

    const { password, otp, otpExpire, ...userWithoutSensitiveData } = user.toObject()

    return res.status(200).json({ message: 'Profile updated successfully', data: userWithoutSensitiveData })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const addAddress = async (req, res) => {
  const { error } = addAddressSchema.validate(req.body)
  if (error) return res.status(400).json({ message: error.details.map((err) => err.message).join(', ') })

  const newAddress = req.body

  try {
    const user = await User.findById(req.user.id)
    user.addresses.push(newAddress)
    await user.save()

    const { password, otp, otpExpire, ...userWithoutSensitiveData } = user.toObject()
    return res.status(200).json({ message: 'Address added successfully', data: userWithoutSensitiveData })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const deleteAddress = async (req, res) => {
  const addressId = req.params.id

  try {
    const user = await User.findById(req.user.id)
    user.addresses = user.addresses.filter((address) => address._id.toString() !== addressId)
    await user.save()

    const { password, otp, otpExpire, ...userWithoutSensitiveData } = user.toObject()
    return res.status(200).json({ message: 'Address deleted successfully', data: userWithoutSensitiveData })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -otp -otpExpire')
    
    // Add current store role if store context exists
    const storeId = req.headers['x-store-id']
    if (storeId) {
      const storeRole = user.storeRoles?.find(
        sr => sr.storeId.toString() === storeId
      )
      if (storeRole) {
        user.currentStoreRole = storeRole.role
      }
    }
    
    return res.status(200).json({ message: 'User data retrieved', data: user })
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong at server level', error: error.message })
  }
}

const showMe = async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Invalid token format' })
    }
    const token = authHeader.split(' ')[1]

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    // Add current store role if store context exists
    const storeId = req.headers['x-store-id']
    if (storeId) {
      const storeRole = decoded.storeRoles?.find(
        sr => sr.storeId.toString() === storeId
      )
      if (storeRole) {
        decoded.currentStoreRole = storeRole.role
      }
    }

    const { _id, name, email, phone, role, addresses, storeRoles } = decoded

    return res.json({
      message: 'User data retrieved',
      data: { _id, name, email, phone, role, addresses, storeRoles }
    })
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token', error: error.message })
  }

}

module.exports = {
  register,
  login,
  forgotPassword,
  verifyOTP,
  resetPassword,
  showMe,
  updateProfile,
  addAddress,
  deleteAddress,
  getUser,
}