import nodemailer from 'nodemailer';

const EMAIL_TIMEOUT_MS = 8000;

const withTimeout = (promise, ms, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export const isEmailConfigured = () => {
  const user = process.env.EMAIL_USER;
  const pass = (process.env.EMAIL_PASSWORD || '').replace(/\s/g, '');
  return Boolean(user && pass);
};

// Explicit SMTP (port 587) so nodemailer timeouts actually apply.
// `service: 'gmail'` often hangs forever on Render when outbound SMTP is blocked.
const createTransporter = () => {
  if (!isEmailConfigured()) {
    throw new Error('Email is not configured');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: (process.env.EMAIL_PASSWORD || '').replace(/\s/g, ''),
    },
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  });
};

const sendMail = async (mailOptions) => {
  const transporter = createTransporter();
  try {
    return await withTimeout(
      transporter.sendMail(mailOptions),
      EMAIL_TIMEOUT_MS,
      'Email send timed out'
    );
  } finally {
    transporter.close();
  }
};

// Generate a 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
export const sendOTPEmail = async (email, otp, username) => {
  try {
    const mailOptions = {
      from: `"E-Process" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Verify Your Email - E-Process',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background-color: #ffffff;
              border-radius: 10px;
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 30px;
              text-align: center;
              color: white;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
            }
            .content {
              padding: 40px 30px;
              text-align: center;
            }
            .content h2 {
              color: #333;
              margin-bottom: 20px;
            }
            .content p {
              color: #666;
              line-height: 1.6;
              margin-bottom: 30px;
            }
            .otp-box {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              font-size: 36px;
              font-weight: bold;
              padding: 20px;
              border-radius: 8px;
              letter-spacing: 8px;
              margin: 30px 0;
              display: inline-block;
            }
            .footer {
              background-color: #f8f9fa;
              padding: 20px;
              text-align: center;
              color: #999;
              font-size: 14px;
            }
            .warning {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
              color: #856404;
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Email Verification</h1>
            </div>
            <div class="content">
              <h2>Hello ${username}!</h2>
              <p>Thank you for registering with E-Process. To complete your registration, please verify your email address using the OTP below:</p>
              
              <div class="otp-box">${otp}</div>
              
              <p>This OTP will expire in <strong>10 minutes</strong>.</p>
              
              <div class="warning">
                <strong>⚠️ Security Notice:</strong> If you didn't request this verification, please ignore this email. Never share your OTP with anyone.
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} E-Process. All rights reserved.</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error.message || error);
    throw new Error('Failed to send verification email');
  }
};

// Send welcome email after successful verification
export const sendWelcomeEmail = async (email, username) => {
  try {
    const mailOptions = {
      from: `"E-Process" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to E-Process! 🎉',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background-color: #ffffff;
              border-radius: 10px;
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 40px;
              text-align: center;
              color: white;
            }
            .header h1 {
              margin: 0;
              font-size: 32px;
            }
            .content {
              padding: 40px 30px;
            }
            .content h2 {
              color: #333;
              margin-bottom: 20px;
            }
            .content p {
              color: #666;
              line-height: 1.8;
              margin-bottom: 20px;
            }
            .button {
              display: inline-block;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 15px 40px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              font-weight: bold;
            }
            .footer {
              background-color: #f8f9fa;
              padding: 20px;
              text-align: center;
              color: #999;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Welcome to E-Process!</h1>
            </div>
            <div class="content">
              <h2>Hello ${username}!</h2>
              <p>Your email has been successfully verified. Welcome to the E-Process community!</p>
              <p>You can now enjoy all the features of our platform:</p>
              <ul>
                <li>Browse our extensive product catalog</li>
                <li>Add items to your cart and wishlist</li>
                <li>Track your orders in real-time</li>
                <li>Manage your profile and preferences</li>
              </ul>
              <p>If you have any questions or need assistance, feel free to reach out to our support team.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} E-Process. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await sendMail(mailOptions);
    console.log('✅ Welcome email sent successfully');
  } catch (error) {
    console.error('❌ Welcome email failed:', error.message || error);
    // Don't throw error for welcome email, it's not critical
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (email, resetUrl) => {
  try {
    const mailOptions = {
      from: `"E-Process" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Request - E-Process',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%); padding: 30px; text-align: center; color: white; }
            .content { padding: 40px 30px; text-align: center; }
            .button { display: inline-block; background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #999; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>🔒 Password Reset</h1></div>
            <div class="content">
              <h2>Reset Your Password</h2>
              <p>You requested a password reset. Please click the button below to set a new password:</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p>Or copy and paste this link into your browser:</p>
              <p><a href="${resetUrl}" style="color: #FF6B6B;">${resetUrl}</a></p>
              <p>This link will expire in 10 minutes.</p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
            <div class="footer"><p>© ${new Date().getFullYear()} E-Process. All rights reserved.</p></div>
          </div>
        </body>
        </html>
      `,
    };

    await sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully');
  } catch (error) {
    console.error('❌ Password reset email failed:', error.message || error);
    throw new Error('Email could not be sent');
  }
};
