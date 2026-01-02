import mongoose from 'mongoose';
import dotenv from 'dotenv';
import readline from 'readline';
import User from '../models/User';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doc-ai';

interface UserInput {
  email: string;
  password: string;
  name: string;
  specialization: string;
  clinicName: string;
  country: string;
}

// Create readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

const getPassword = async (): Promise<string> => {
  // For simplicity, we'll use regular input with a warning
  // In production environments, consider using a library like 'readline-sync' or 'inquirer'
  console.log('⚠️  Note: Password will be visible as you type (use command line args for secure input)');
  const password = await question('Password: ');
  return password;
};

const promptForInput = async (): Promise<UserInput> => {
  console.log('\n=== Create Admin User ===\n');
  
  const email = await question('Email: ');
  if (!email) {
    throw new Error('Email is required');
  }

  const password = await getPassword();
  if (!password) {
    throw new Error('Password is required');
  }

  const name = await question('Name: ');
  if (!name) {
    throw new Error('Name is required');
  }

  const specialization = await question('Specialization: ');
  if (!specialization) {
    throw new Error('Specialization is required');
  }

  const clinicName = await question('Clinic Name: ');
  if (!clinicName) {
    throw new Error('Clinic Name is required');
  }

  const country = await question('Country: ');
  if (!country) {
    throw new Error('Country is required');
  }

  return { email, password, name, specialization, clinicName, country };
};

const parseArgs = (): UserInput | null => {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return null; // Use interactive mode
  }

  // Parse command line arguments
  // Format: --email=value --password=value --name=value --specialization=value --clinicName=value --country=value
  const parsed: Partial<UserInput> = {};
  
  args.forEach((arg) => {
    const match = arg.match(/^--(\w+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      parsed[key as keyof UserInput] = value;
    }
  });

  // Check if all required fields are present
  const required = ['email', 'password', 'name', 'specialization', 'clinicName', 'country'];
  const missing = required.filter((field) => !parsed[field as keyof UserInput]);
  
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(', ')}`);
    console.error('\nUsage:');
    console.error('  Interactive mode: npm run create-admin');
    console.error('  Command line: npm run create-admin -- --email=admin@example.com --password=secret --name="Admin User" --specialization="General" --clinicName="Admin Clinic" --country="US"');
    process.exit(1);
  }

  return parsed as UserInput;
};

const createAdminUser = async (userData: UserInput) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: userData.email.toLowerCase() });
    if (existingUser) {
      if (existingUser.role === 'admin') {
        console.log(`\n✓ User with email ${userData.email} already exists and is already an admin.`);
        return;
      } else {
        // Update existing user to admin
        existingUser.role = 'admin';
        existingUser.password = userData.password; // Will be hashed by pre-save hook
        await existingUser.save();
        console.log(`\n✓ Existing user ${userData.email} has been promoted to admin.`);
        return;
      }
    }

    // Create new admin user
    const adminUser = new User({
      ...userData,
      email: userData.email.toLowerCase(),
      role: 'admin',
    });

    await adminUser.save();
    console.log(`\n✓ Admin user created successfully!`);
    console.log(`  Email: ${adminUser.email}`);
    console.log(`  Name: ${adminUser.name}`);
    console.log(`  Role: ${adminUser.role}`);
  } catch (error: any) {
    if (error.code === 11000) {
      console.error(`\n✗ Error: User with email ${userData.email} already exists.`);
    } else {
      console.error(`\n✗ Error creating admin user: ${error.message}`);
    }
    throw error;
  }
};

const main = async () => {
  try {
    // Parse command line arguments or use interactive mode
    const userData = parseArgs() || await promptForInput();
    
    // Connect to MongoDB
    console.log('\nConnecting to MongoDB...');
    const mongooseOptions: mongoose.ConnectOptions = {
      tls: MONGODB_URI.includes('mongodb+srv://') || process.env.MONGODB_TLS === 'true',
      tlsAllowInvalidCertificates: process.env.MONGODB_TLS_ALLOW_INVALID === 'true',
    };

    await mongoose.connect(MONGODB_URI, mongooseOptions);
    console.log('✓ Connected to MongoDB\n');

    // Create admin user
    await createAdminUser(userData);

    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed.');
    process.exit(0);
  } catch (error: any) {
    console.error(`\n✗ Fatal error: ${error.message}`);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  } finally {
    rl.close();
  }
};

// Run the script
main();

