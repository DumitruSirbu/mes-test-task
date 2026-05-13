import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/UserEntity';
import { UsersRepository } from './repository/UsersRepository';
import { UsersService } from './service/UsersService';

@Module({
    imports: [TypeOrmModule.forFeature([UserEntity])],
    providers: [UsersRepository, UsersService],
    exports: [UsersService, UsersRepository],
})
export class UsersModule {}
