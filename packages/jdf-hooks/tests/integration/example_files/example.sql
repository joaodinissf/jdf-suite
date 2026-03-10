-- Badly formatted SQL file
SELECT u.id,u.name,u.email,p.title,p.content FROM users u LEFT JOIN posts p ON u.id=p.user_id WHERE u.created_at>'2023-01-01' AND u.active=true ORDER BY u.name;

CREATE TABLE IF NOT EXISTS user_profiles(
id SERIAL PRIMARY KEY,
user_id INTEGER REFERENCES users(id),
bio TEXT,
avatar_url VARCHAR(255),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users(name,email,active) VALUES('John Doe','john@example.com',true),('Jane Smith','jane@example.com',false);

UPDATE users SET last_login=NOW() WHERE id IN(1,2,3);

DELETE FROM posts WHERE created_at<'2022-01-01' AND status='draft';