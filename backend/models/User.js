const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: ['Admin', 'User'],
      default: 'User',
    },
    accessPages: {
      type: [String],
      enum: ['Dashboard', 'Plant', 'Vehicle Register', 'Driver Registry', 'GPS', 'User Management'],
      default: ['Dashboard'],
    },
    accessPlants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plant',
      },
    ],
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
