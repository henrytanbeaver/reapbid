import React, { useState } from 'react';
import { getDatabase, ref, get, set } from 'firebase/database';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Stack
} from '@mui/material';

const UserAdmin: React.FC = () => {
  const [userUid, setUserUid] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ isAdmin: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCheckAdmin = async () => {
    if (!userUid.trim()) {
      setError('Please enter a user UID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setResult(null);

    try {
      const db = getDatabase();
      const adminRef = ref(db, `users/${userUid}/roles/admin`);
      const snapshot = await get(adminRef);
      setResult({ isAdmin: snapshot.val() === true });
    } catch (error) {
      console.error('Error checking admin status:', error);
      setError('Failed to check admin status');
    } finally {
      setLoading(false);
    }
  };

  const handleSetAdmin = async () => {
    if (!userUid.trim()) {
      setError('Please enter a user UID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setResult(null);

    try {
      const db = getDatabase();
      const adminRef = ref(db, `users/${userUid}/roles/admin`);
      await set(adminRef, true);
      setSuccess('Admin access granted successfully');
      
      // Check the new status
      const snapshot = await get(adminRef);
      setResult({ isAdmin: snapshot.val() === true });
    } catch (error) {
      console.error('Error setting admin status:', error);
      setError('Failed to grant admin access');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="h5" gutterBottom>
          User Admin Management
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            fullWidth
            label="User UID"
            value={userUid}
            onChange={(e) => setUserUid(e.target.value)}
            disabled={loading}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={handleCheckAdmin}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Check'}
            </Button>
            <Button
              variant="contained"
              onClick={handleSetAdmin}
              disabled={loading}
              color="primary"
            >
              {loading ? <CircularProgress size={24} /> : 'Set Admin'}
            </Button>
          </Stack>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {success}
          </Alert>
        )}

        {result !== null && !error && (
          <Alert 
            severity={result.isAdmin ? "success" : "info"}
            sx={{ mt: 2 }}
          >
            User is {result.isAdmin ? 'an admin' : 'not an admin'}
          </Alert>
        )}
      </Paper>
    </Box>
  );
};

export default UserAdmin;
