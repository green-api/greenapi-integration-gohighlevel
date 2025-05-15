-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `accessToken` TEXT NOT NULL,
    `refreshToken` TEXT NOT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Instance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `idInstance` BIGINT NOT NULL,
    `apiTokenInstance` VARCHAR(191) NOT NULL,
    `stateInstance` ENUM('notAuthorized', 'authorized', 'yellowCard', 'blocked', 'starting') NULL,
    `userId` VARCHAR(191) NOT NULL,
    `settings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Instance_idInstance_key`(`idInstance`),
    UNIQUE INDEX `Instance_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Instance` ADD CONSTRAINT `Instance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
