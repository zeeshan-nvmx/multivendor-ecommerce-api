const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const validateStore = require('../middleware/validateStore')
const { authorizeStore } = require('../middleware/storeAuthorization')
const { register, login, forgotPassword, verifyOTP, resetPassword, showMe, updateProfile, addAddress, deleteAddress, getUser } = require('../controllers/authController')

// Public routes
router.post('/register', register)
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/verify-otp', verifyOTP)
router.post('/reset-password', resetPassword)
router.get('/showme', showMe)

// Protected routes
router.get('/getuser', auth, getUser)
router.put('/updateprofile', auth, updateProfile)
router.post('/addresses', auth, addAddress)
router.delete('/addresses/:id', auth, deleteAddress)

// Store-specific routes
router.post('/store/register', auth, validateStore, authorizeStore(['store_admin']), register)

module.exports = router
