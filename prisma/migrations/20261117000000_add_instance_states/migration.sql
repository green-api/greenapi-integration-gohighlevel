-- AlterTable
ALTER TABLE `Instance` MODIFY `stateInstance` ENUM('notAuthorized', 'authorized', 'yellowCard', 'blocked', 'starting', 'pendingCode', 'suspended', 'pendingPassword') NULL;
