// TRIAGE dual-mode robot sketch
// Mode 1: LINE  -> original line follower behavior preserved
// Mode 2: AI    -> Brain Pi drives the motors over USB serial

// --- PINOUT (DO NOT CHANGE) ---
#define enA 5
#define in1 4
#define in2 7

#define enB 6
#define in3 8
#define in4 11

#define L_S 12
#define R_S 13

// --- ULTRASONIC PINS ---
#define TRIG 9
#define ECHO 10

// --- SETTINGS (line mode calmer forward speed, full-strength turning) ---
int spd = 185;
int turnSpd = 255;
int aiForwardSpd = 255;
int aiReverseSpd = 200;
int aiTurnSpd = 255;

enum RobotMode {
  MODE_LINE,
  MODE_AI
};

RobotMode currentMode = MODE_LINE;
String aiDrive = "STOP";
unsigned long lastAiMessageAt = 0;
const unsigned long AI_TIMEOUT_MS = 1200;
String serialBuffer = "";

void setup() {
  Serial.begin(9600);

  pinMode(R_S, INPUT);
  pinMode(L_S, INPUT);

  pinMode(enA, OUTPUT);
  pinMode(in1, OUTPUT);
  pinMode(in2, OUTPUT);
  pinMode(enB, OUTPUT);
  pinMode(in3, OUTPUT);
  pinMode(in4, OUTPUT);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  analogWrite(enA, spd);
  analogWrite(enB, spd);

  Stop();
  Serial.println("READY MODE=LINE");
}

void loop() {
  handleSerialInput();

  if (currentMode == MODE_AI) {
    runAiMode();
    return;
  }

  runLineFollowerMode();
}

void handleSerialInput() {
  while (Serial.available() > 0) {
    char incoming = (char)Serial.read();

    if (incoming == '\r') {
      continue;
    }

    if (incoming == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        processSerialCommand(serialBuffer);
      }
      serialBuffer = "";
      continue;
    }

    serialBuffer += incoming;
  }
}

void processSerialCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "PING") {
    lastAiMessageAt = millis();
    Serial.println("OK PING");
    return;
  }

  if (command == "STATUS") {
    sendStatus();
    return;
  }

  if (command == "MODE LINE") {
    currentMode = MODE_LINE;
    aiDrive = "STOP";
    Stop();
    Serial.println("OK MODE LINE");
    sendStatus();
    return;
  }

  if (command == "MODE AI") {
    currentMode = MODE_AI;
    aiDrive = "STOP";
    lastAiMessageAt = millis();
    Stop();
    Serial.println("OK MODE AI");
    sendStatus();
    return;
  }

  if (command.startsWith("DRIVE ")) {
    if (currentMode != MODE_AI) {
      Serial.println("ERR MODE LINE");
      return;
    }

    String driveCommand = command.substring(6);
    driveCommand.trim();
    executeAiDrive(driveCommand);
    lastAiMessageAt = millis();
    Serial.print("OK DRIVE ");
    Serial.println(aiDrive);
    sendStatus();
    return;
  }

  Serial.println("ERR UNKNOWN");
}

void runAiMode() {
  if (millis() - lastAiMessageAt > AI_TIMEOUT_MS) {
    if (aiDrive != "STOP") {
      aiDrive = "STOP";
      Stop();
      Serial.println("WARN AI TIMEOUT");
      sendStatus();
    }
    return;
  }

  long distance = readDistance();
  if (aiDrive == "FWD" && distance > 0 && distance < 15) {
    aiDrive = "STOP";
    Stop();
    Serial.println("WARN OBSTACLE");
    sendStatus();
  }
}

void executeAiDrive(String driveCommand) {
  if (driveCommand == "FWD") {
    aiDrive = "FWD";
    aiForward();
    return;
  }

  if (driveCommand == "BACK") {
    aiDrive = "BACK";
    aiBackward();
    return;
  }

  if (driveCommand == "LEFT") {
    aiDrive = "LEFT";
    aiTurnLeft();
    return;
  }

  if (driveCommand == "RIGHT") {
    aiDrive = "RIGHT";
    aiTurnRight();
    return;
  }

  aiDrive = "STOP";
  Stop();
}

void sendStatus() {
  Serial.print("STATE MODE=");
  Serial.print(currentMode == MODE_LINE ? "LINE" : "AI");
  Serial.print(" DRIVE=");
  Serial.print(aiDrive);
  Serial.print(" DIST=");
  Serial.println(readDistance());
}

void runLineFollowerMode() {
  // --- WALL DETECTION ---
  long distance = readDistance();
  if (distance > 0 && distance < 15) {
    turnAround();
    return;
  }

  // --- LINE FOLLOWING ---
  // Read Sensors: LOW (0) = White, HIGH (1) = Black
  int left  = digitalRead(L_S);
  int right = digitalRead(R_S);

  if (left == 0 && right == 0) {
    // Both white -> line is between sensors, go straight
    forward();
  }
  else if (left == 0 && right == 1) {
    // Right on black -> turn right
    turnRight();
  }
  else if (left == 1 && right == 0) {
    // Left on black -> turn left
    turnLeft();
  }
  else {
    // Both black (intersection / wide line) -> go straight through
    forward();
  }
}

void forward() {
  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
  analogWrite(enA, spd);

  digitalWrite(in3, HIGH);
  digitalWrite(in4, LOW);
  analogWrite(enB, spd);
}

void aiForward() {
  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
  analogWrite(enA, aiForwardSpd);

  digitalWrite(in3, HIGH);
  digitalWrite(in4, LOW);
  analogWrite(enB, aiForwardSpd);
}

void aiBackward() {
  digitalWrite(in1, LOW);
  digitalWrite(in2, HIGH);
  analogWrite(enA, aiReverseSpd);

  digitalWrite(in3, LOW);
  digitalWrite(in4, HIGH);
  analogWrite(enB, aiReverseSpd);
}

void aiTurnRight() {
  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
  analogWrite(enA, aiTurnSpd);

  digitalWrite(in3, LOW);
  digitalWrite(in4, HIGH);
  analogWrite(enB, aiTurnSpd);
}

void aiTurnLeft() {
  digitalWrite(in1, LOW);
  digitalWrite(in2, HIGH);
  analogWrite(enA, aiTurnSpd);

  digitalWrite(in3, HIGH);
  digitalWrite(in4, LOW);
  analogWrite(enB, aiTurnSpd);
}

void backward() {
  digitalWrite(in1, LOW);
  digitalWrite(in2, HIGH);
  analogWrite(enA, spd);

  digitalWrite(in3, LOW);
  digitalWrite(in4, HIGH);
  analogWrite(enB, spd);
}

void turnRight() {
  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
  analogWrite(enA, turnSpd);

  digitalWrite(in3, LOW);
  digitalWrite(in4, HIGH);
  analogWrite(enB, turnSpd);
}

void turnLeft() {
  digitalWrite(in1, LOW);
  digitalWrite(in2, HIGH);
  analogWrite(enA, turnSpd);

  digitalWrite(in3, HIGH);
  digitalWrite(in4, LOW);
  analogWrite(enB, turnSpd);
}

void Stop() {
  digitalWrite(in1, LOW);
  digitalWrite(in2, LOW);
  digitalWrite(in3, LOW);
  digitalWrite(in4, LOW);
  analogWrite(enA, 0);
  analogWrite(enB, 0);
}

long readDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);

  if (duration == 0) {
    return 999;
  }

  float dist = duration * 0.034 / 2;
  return (long)dist;
}

void turnAround() {
  Stop();
  delay(100);

  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
  digitalWrite(in3, LOW);
  digitalWrite(in4, HIGH);
  analogWrite(enA, turnSpd);
  analogWrite(enB, turnSpd);

  delay(500);

  Stop();
  delay(100);
}
