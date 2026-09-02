// authController.js
import User from '../models/user.js';
import jwt from 'jsonwebtoken';
import { AppError, catchAsync } from '../middleware/errorHandler.js';
import { generateOTP, sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } from '../utils/emailService.js';
import crypto from 'crypto';

// Generate JWT Token
const generateToken = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });

  // Don't set cookies since client is using localStorage
  // Just return the token for the client to store
  return token;
};

// @desc    Register a new user (Step 1: Send OTP)
// @route   POST /api/auth/register
// @access  Public
export const registerUser = catchAsync(async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const role = 'admin';

    // Enhanced validation
    const errors = [];

    if (!username || username.trim().length < 3) {
      errors.push('Username must be at least 3 characters long');
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Please provide a valid email address');
    }

    if (!password || password.length < 6) {
      errors.push('Password must be at least 6 characters long');
    }

    if (!['admin'].includes(role)) {
      errors.push('Invalid role provided');
    }

    if (errors.length > 0) {
      return next(new AppError('Validation failed', 400));
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.trim().toLowerCase();

    const existingByEmail = await User.findOne({ email: normalizedEmail });
    const existingByUsername = await User.findOne({ username: normalizedUsername });

    if (existingByUsername && existingByUsername.email !== normalizedEmail) {
      return next(new AppError('Username already taken', 400));
    }

    if (existingByEmail && (existingByEmail.isEmailVerified || existingByEmail.status === 'active')) {
      return next(new AppError('Email already in use', 400));
    }

    // Reuse a leftover pending account from a previous hung signup
    let user = existingByEmail;
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    if (user) {
      user.username = normalizedUsername;
      user.password = password;
      user.role = role;
      user.emailVerificationOTP = otp;
      user.otpExpires = otpExpires;
      user.isEmailVerified = false;
      user.status = 'pending';
    } else {
      user = new User({
        username: normalizedUsername,
        email: normalizedEmail,
        password,
        role,
        emailVerificationOTP: otp,
        otpExpires,
        isEmailVerified: false,
        status: 'pending'
      });
    }

    await user.save();

    let emailSent = false;
    try {
      await sendOTPEmail(normalizedEmail, otp, normalizedUsername);
      emailSent = true;
    } catch (emailError) {
      console.error('OTP email failed on register:', emailError.message || emailError);
    }

    if (!emailSent) {
      // Render often blocks Gmail SMTP, which previously left the request hanging
      // and the user stuck on "Creating Account...". Complete signup instead.
      user.isEmailVerified = true;
      user.status = 'active';
      user.emailVerificationOTP = undefined;
      user.otpExpires = undefined;
      await user.save();

      const token = generateToken(res, user._id);
      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.emailVerificationOTP;
      delete userResponse.otpExpires;

      return res.status(201).json({
        success: true,
        requiresVerification: false,
        message: 'Registration successful',
        token,
        user: userResponse,
        email: normalizedEmail,
      });
    }

    res.status(201).json({
      success: true,
      requiresVerification: true,
      message: 'Registration successful! Please check your email for the verification code.',
      email: normalizedEmail,
      userId: user._id
    });

  } catch (err) {
    // Let the global error handler deal with it
    next(err);
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = catchAsync(async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Enhanced validation
    if (!email || !password) {
      return next(new AppError('Email and password are required', 400));
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return next(new AppError('Please provide a valid email address', 400));
    }

    // Check for user (case insensitive email search)
    const user = await User.findOne({
      email: email.toLowerCase().trim()
    }).select('+password');

    if (!user) {
      return next(new AppError('Invalid email or password', 401));
    }

    // Check if user account is active
    if (user.status !== 'active') {
      return next(new AppError('Account is suspended. Please contact support.', 401));
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(new AppError('Invalid email or password', 401));
    }

    if (user.role !== 'admin') {
      return next(new AppError('Only admin accounts can sign in', 403));
    }

    // Update last login timestamp (optional)
    user.lastLogin = new Date();
    await user.save();

    // Generate token and send response
    const token = generateToken(res, user._id);
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.lastLogin; // Don't send lastLogin in response

    res.json({
      success: true,
      token,
      user: userResponse,
      message: 'Login successful'
    });

  } catch (err) {
    next(err);
  }
});

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Private
export const logoutUser = (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0)
  });
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Private
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    res.json({ success: true, user });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
export const updateUserProfile = async (req, res) => {
  try {
    const { username, email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if username or email already exists (excluding current user)
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken'
        });
      }
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already in use'
        });
      }
    }

    // Update basic fields
    if (username) user.username = username;
    if (email) user.email = email;

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is required to change password'
        });
      }

      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      user.password = newPassword;
    }

    await user.save();

    // Send response without password
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: userResponse
    });

  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Profile update failed'
    });
  }
};
// @desc    Verify email with OTP
// @route   POST /api/auth/verify-email
// @access  Public
export const verifyEmail = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return next(new AppError('Email and OTP are required', 400));
  }

  const user = await User.findOne({
    email: email.toLowerCase().trim()
  }).select('+emailVerificationOTP +otpExpires');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified. Please login.', 400));
  }

  if (user.emailVerificationOTP !== otp) {
    return next(new AppError('Invalid OTP', 400));
  }

  if (user.otpExpires < Date.now()) {
    return next(new AppError('OTP has expired. Please request a new one.', 400));
  }

  // Verify user
  user.isEmailVerified = true;
  user.status = 'active'; // Activate user account
  user.emailVerificationOTP = undefined;
  user.otpExpires = undefined;
  await user.save();

  // Send welcome email
  sendWelcomeEmail(user.email, user.username).catch(console.error);

  // Generate token and login user immediately
  const token = generateToken(res, user._id);
  const userResponse = user.toObject();
  delete userResponse.password;
  delete userResponse.emailVerificationOTP;
  delete userResponse.otpExpires;

  res.status(200).json({
    success: true,
    message: 'Email verified successfully',
    token, // Send token so user is automatically logged in
    user: userResponse
  });
});

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
export const resendOTP = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError('Email is required', 400));
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified. Please login.', 400));
  }

  // Generate new OTP
  const otp = generateOTP();
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  user.emailVerificationOTP = otp;
  user.otpExpires = otpExpires;
  await user.save();

  // Send OTP email
  try {
    await sendOTPEmail(user.email, otp, user.username);
  } catch (error) {
    return next(new AppError('Failed to send verification email', 500));
  }

  res.status(200).json({
    success: true,
    message: 'Verification code resent successfully'
  });
});

// @desc    Forgot Password - Send reset link
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = catchAsync(async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
        return next(new AppError('Please provide your email address', 400));
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    // Get reset token
    const resetToken = user.getResetPasswordToken();

    await user.save({ validateBeforeSave: false });

    // Create reset URL
    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}reset-password/${resetToken}`;

    try {
        await sendPasswordResetEmail(user.email, resetUrl);

        res.status(200).json({
            success: true,
            message: 'Email sent'
        });
    } catch (err) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;

        await user.save({ validateBeforeSave: false });

        return next(new AppError('Email could not be sent', 500));
    }
});

// @desc    Reset Password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
export const resetPassword = catchAsync(async (req, res, next) => {
    // Get hashed token
    const resetPasswordToken = crypto
        .createHash('sha256')
        .update(req.params.token)
        .digest('hex');

    const user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
        return next(new AppError('Invalid token', 400));
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    // Log user in
    const token = generateToken(res, user._id);
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
        success: true,
        token,
        user: userResponse,
        message: 'Password updated successfully'
    });
});
