import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationEntity } from './entity/InvitationEntity';
import { InvitationsRepository } from './repository/InvitationsRepository';
import { InvitationsService } from './service/InvitationsService';

@Module({
    imports: [TypeOrmModule.forFeature([InvitationEntity])],
    providers: [InvitationsRepository, InvitationsService],
    exports: [InvitationsService, InvitationsRepository],
})
export class InvitationsModule {}
