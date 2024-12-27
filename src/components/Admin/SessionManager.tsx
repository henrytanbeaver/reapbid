import React, { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  ButtonGroup,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Tooltip,
  CircularProgress,
  Grid,
  Stepper,
  Step,
  StepLabel,
  FormGroup,
  FormControlLabel,
  Switch,
  Divider,
  Stack
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSession } from '../../context/SessionContext';
import { useGame } from '../../context/GameContext';
import { generateSessionName, getNextCategory } from '../../utils/sessionNameGenerator';
import { GameConfig, VisibilitySettings } from '../../context/GameContext';
import { displayRound } from '../../utils/gameFormatters';

const defaultConfig: GameConfig = {
  totalRounds: 3,
  roundTimeLimit: 300,
  minBid: 1,
  maxBid: 200,
  costPerUnit: 25,
  maxPlayers: 10,
  visibilitySettings: {
    showRounds: true,
    showCostPerUnit: true,
    showPriceRange: true
  }
};

const SessionManagerComponent: React.FC = () => {
  const {
    sessions,
    currentSessionId,
    isLoading,
    error,
    selectSession,
    createSession,
    updateSessionStatus,
    deleteSession,
    refreshSessions
  } = useSession();
  const { gameState, startGame, resetGame } = useGame();

  // Local state for UI
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [newSessionName, setNewSessionName] = useState('');
  const [currentCategory, setCurrentCategory] = useState<'animals' | 'flowers' | 'cars' | 'cities'>('animals');
  const [config, setConfig] = useState<GameConfig>(defaultConfig);
  const [createError, setCreateError] = useState<string | null>(null);

  // Memoized values
  const steps = useMemo(() => ['Name Your Session', 'Configure Game Settings', 'Visibility Settings'], []);
  const getStatusColor = (status: string): 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning' => {
    switch (status) {
      case 'active':
        return 'success';
      case 'completed':
        return 'info';
      case 'archived':
        return 'default';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const sessionData = useMemo(() => {
    return sessions.map(session => ({
      ...session,
      isSelected: session.id === currentSessionId,
      statusColor: getStatusColor(session.status)
    }));
  }, [sessions, currentSessionId]);

  // Handlers
  const handleNext = useCallback(() => {
    if (activeStep === 0 && !newSessionName.trim()) {
      setCreateError('Session name cannot be empty');
      return;
    }
    setActiveStep((prevStep) => prevStep + 1);
    setCreateError(null);
  }, [activeStep, newSessionName]);

  const handleBack = useCallback(() => {
    setActiveStep((prevStep) => prevStep - 1);
    setCreateError(null);
  }, []);

  const handleCreateSession = useCallback(async () => {
    try {
      const sessionId = await createSession(newSessionName.trim(), config);
      selectSession(sessionId);
      setIsCreateDialogOpen(false);
      setNewSessionName('');
      setConfig(defaultConfig);
      setActiveStep(0);
      setCreateError(null);
      setCurrentCategory(getNextCategory(currentCategory));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [newSessionName, config, createSession, selectSession, currentCategory]);

  const handleOpenCreateDialog = useCallback(() => {
    setNewSessionName(generateSessionName(currentCategory));
    setConfig(defaultConfig);
    setActiveStep(0);
    setCreateError(null);
    setIsCreateDialogOpen(true);
  }, [currentCategory]);

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
  }, [selectSession]);

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  }, []);

  const renderStepContent = useCallback((step: number) => {
    switch (step) {
      case 0:
        return (
          <>
            <Box sx={{ mb: 2, mt: 1 }}>
              <ButtonGroup size="small" sx={{ mb: 2 }}>
                <Button 
                  variant={currentCategory === 'animals' ? 'contained' : 'outlined'}
                  onClick={() => setNewSessionName(generateSessionName('animals'))}
                >
                  Animal
                </Button>
                <Button 
                  variant={currentCategory === 'flowers' ? 'contained' : 'outlined'}
                  onClick={() => setNewSessionName(generateSessionName('flowers'))}
                >
                  Flower
                </Button>
                <Button 
                  variant={currentCategory === 'cars' ? 'contained' : 'outlined'}
                  onClick={() => setNewSessionName(generateSessionName('cars'))}
                >
                  Car
                </Button>
                <Button 
                  variant={currentCategory === 'cities' ? 'contained' : 'outlined'}
                  onClick={() => setNewSessionName(generateSessionName('cities'))}
                >
                  City
                </Button>
              </ButtonGroup>
            </Box>
            <TextField
              autoFocus
              margin="dense"
              label="Session Name"
              fullWidth
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              error={!!createError}
              helperText={createError}
            />
          </>
        );
      case 1:
        return (
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>
                Game Rules
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Total Rounds"
                type="number"
                value={config.totalRounds}
                onChange={(e) => setConfig({
                  ...config,
                  totalRounds: parseInt(e.target.value) || 0
                })}
                helperText="Number of rounds (1-10)"
                inputProps={{ min: 1, max: 10 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Round Time Limit (seconds)"
                type="number"
                value={config.roundTimeLimit}
                onChange={(e) => setConfig({
                  ...config,
                  roundTimeLimit: parseInt(e.target.value) || 0
                })}
                helperText="Time limit per round in seconds (30-600)"
                inputProps={{ min: 30, max: 600 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Minimum Bid"
                type="number"
                value={config.minBid}
                onChange={(e) => setConfig({
                  ...config,
                  minBid: parseInt(e.target.value) || 0
                })}
                helperText="Minimum allowed bid (1+)"
                inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Maximum Bid"
                type="number"
                value={config.maxBid}
                onChange={(e) => setConfig({
                  ...config,
                  maxBid: parseInt(e.target.value) || 0
                })}
                helperText="Maximum allowed bid (must be > min bid, ≤ 1000)"
                inputProps={{ min: 1, max: 1000 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Cost Per Unit"
                type="number"
                value={config.costPerUnit}
                onChange={(e) => setConfig({
                  ...config,
                  costPerUnit: parseInt(e.target.value) || 0
                })}
                helperText="Cost per unit (1-100)"
                inputProps={{ min: 1, max: 100 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Maximum Players"
                type="number"
                value={config.maxPlayers}
                onChange={(e) => setConfig({
                  ...config,
                  maxPlayers: parseInt(e.target.value) || 0
                })}
                helperText="Maximum number of players (2-20)"
                inputProps={{ min: 2, max: 20 }}
              />
            </Grid>
          </Grid>
        );
      case 2:
        return (
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Information Visibility
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Control what information is visible to players during the game.
            </Typography>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.visibilitySettings?.showRounds ?? true}
                    onChange={(e) => {
                      const newSettings = {
                        showRounds: e.target.checked,
                        showCostPerUnit: config.visibilitySettings?.showCostPerUnit ?? true,
                        showPriceRange: config.visibilitySettings?.showPriceRange ?? true
                      };
                      setConfig({
                        ...config,
                        visibilitySettings: newSettings
                      });
                      // Update game if it's started
                      if (gameState?.hasGameStarted) {
                        startGame({
                          ...config,
                          visibilitySettings: newSettings
                        });
                      }
                    }}
                  />
                }
                label="Show Total Rounds"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.visibilitySettings?.showCostPerUnit ?? true}
                    onChange={(e) => {
                      const newSettings = {
                        showRounds: config.visibilitySettings?.showRounds ?? true,
                        showCostPerUnit: e.target.checked,
                        showPriceRange: config.visibilitySettings?.showPriceRange ?? true
                      };
                      setConfig({
                        ...config,
                        visibilitySettings: newSettings
                      });
                      // Update game if it's started
                      if (gameState?.hasGameStarted) {
                        startGame({
                          ...config,
                          visibilitySettings: newSettings
                        });
                      }
                    }}
                  />
                }
                label="Show Cost Per Unit"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.visibilitySettings?.showPriceRange ?? true}
                    onChange={(e) => {
                      const newSettings = {
                        showRounds: config.visibilitySettings?.showRounds ?? true,
                        showCostPerUnit: config.visibilitySettings?.showCostPerUnit ?? true,
                        showPriceRange: e.target.checked
                      };
                      setConfig({
                        ...config,
                        visibilitySettings: newSettings
                      });
                      // Update game if it's started
                      if (gameState?.hasGameStarted) {
                        startGame({
                          ...config,
                          visibilitySettings: newSettings
                        });
                      }
                    }}
                  />
                }
                label="Show Price Range (Min/Max Bid)"
              />
            </FormGroup>
          </Box>
        );
      default:
        return null;
    }
  }, [newSessionName, config, currentCategory, createError, gameState]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setIsCreateDialogOpen(true)}
            sx={{ minWidth: 150 }}
          >
            New Session
          </Button>
          <IconButton 
            onClick={refreshSessions}
            color="primary"
            size="small"
            sx={{ ml: 1 }}
          >
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Box>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Session Name</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Players</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Round</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '10%' }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : sessionData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 2, color: 'text.secondary' }}>
                  No sessions found. Create a new session to get started.
                </TableCell>
              </TableRow>
            ) : (
              sessionData.map((session) => (
                <TableRow 
                  key={session.id}
                  onClick={() => !isLoading && selectSession(session.id)}
                  sx={{
                    cursor: 'pointer',
                    backgroundColor: session.isSelected ? 'action.selected' : 'inherit',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  <TableCell sx={{ fontWeight: session.isSelected ? 'bold' : 'normal' }}>
                    {session.name}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={session.status}
                      size="small"
                      color={session.statusColor}
                      variant={session.isSelected ? "filled" : "outlined"}
                      sx={{ minWidth: 80 }}
                    />
                  </TableCell>
                  <TableCell>
                    {session.players || 0}
                  </TableCell>
                  <TableCell>
                    {session.currentRound !== undefined ? displayRound(session.currentRound, session.totalRounds) : '-'}
                  </TableCell>
                  <TableCell>
                    {new Date(session.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete Session">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        sx={{
                          opacity: 0.7,
                          '&:hover': {
                            opacity: 1,
                            color: 'error.main'
                          }
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog 
        open={isCreateDialogOpen} 
        onClose={() => setIsCreateDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Create New Session</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ pt: 3, pb: 5 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          {renderStepContent(activeStep)}
          {createError && (
            <Typography color="error" sx={{ mt: 2 }}>
              {createError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
          {activeStep === 0 && (
            <Button 
              onClick={() => setNewSessionName(generateSessionName(currentCategory))}
              color="info"
            >
              Regenerate Name
            </Button>
          )}
          {activeStep > 0 && (
            <Button onClick={handleBack}>Back</Button>
          )}
          {activeStep === steps.length - 1 ? (
            <Button onClick={handleCreateSession} variant="contained">
              Create Session
            </Button>
          ) : (
            <Button onClick={handleNext} variant="contained">
              Next
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export const SessionManager = React.memo(SessionManagerComponent);
